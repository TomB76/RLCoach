/**
 * Coach IA optionnel.
 *
 * Principe : le moteur déterministe (percentiles + règles) reste la source de
 * vérité. L'IA ne fait que **mettre en mots** ce diagnostic, avec un ton de
 * coach, et proposer un plan. Aucun chiffre n'est calculé par le modèle : on lui
 * fournit les métriques déjà calculées et on lui interdit d'en inventer.
 *
 * API ciblée : `POST {baseUrl}/chat/completions`, format OpenAI (compatible
 * OpenAI, Azure OpenAI, Ollama, LM Studio, vLLM, OpenRouter…).
 */

export const AI_PROVIDERS = {
  none: { label: 'Désactivé', requiresKey: false, defaultBaseUrl: '', defaultModel: '' },
  openai: {
    label: 'OpenAI',
    requiresKey: true,
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
  },
  ollama: {
    label: 'Ollama (local)',
    requiresKey: false,
    defaultBaseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'llama3.1',
  },
  custom: { label: 'API compatible OpenAI', requiresKey: false, defaultBaseUrl: '', defaultModel: '' },
};

/**
 * Valide la configuration et indique pourquoi l'IA est indisponible.
 * @returns {{enabled:boolean, provider:string, baseUrl:string, model:string, apiKey:string, reason:string|null}}
 */
export function resolveAiConfig(config = {}) {
  const provider = AI_PROVIDERS[config.provider] ? config.provider : 'none';
  const preset = AI_PROVIDERS[provider];
  const baseUrl = String(config.baseUrl || preset.defaultBaseUrl || '').trim().replace(/\/+$/, '');
  const model = String(config.model || preset.defaultModel || '').trim();
  const apiKey = String(config.apiKey || '').trim();

  if (provider === 'none') {
    return { enabled: false, provider, baseUrl, model, apiKey, reason: "Le coach IA est désactivé dans les réglages." };
  }
  if (!baseUrl) {
    return {
      enabled: false,
      provider,
      baseUrl,
      model,
      apiKey,
      reason: 'Renseigne l’URL de base de l’API (ex. https://api.openai.com/v1).',
    };
  }
  if (!model) {
    return { enabled: false, provider, baseUrl, model, apiKey, reason: 'Renseigne le nom du modèle (ex. gpt-4o-mini).' };
  }
  if (preset.requiresKey && !apiKey) {
    return { enabled: false, provider, baseUrl, model, apiKey, reason: 'Renseigne ta clé API pour ce fournisseur.' };
  }
  return { enabled: true, provider, baseUrl, model, apiKey, reason: null };
}

/**
 * Position factuelle d'une valeur dans la fourchette p25–p75 de la référence.
 * Aucun jugement de valeur : le sens de la métrique est transmis séparément
 * (`plus_est_mieux` / `moins_est_mieux`), pour éviter les contresens sur des
 * métriques comme « temps à 0 boost ».
 */
export function positionVsRange(value, p25, p75) {
  if (!Number.isFinite(value) || !Number.isFinite(p25) || !Number.isFinite(p75)) return null;
  if (value < p25) return 'sous_p25';
  if (value > p75) return 'au_dessus_p75';
  return 'dans_p25_p75';
}

const SYSTEM_PROMPT = `Tu es un coach professionnel de Rocket League (niveau RLCS), francophone.
Règles absolues :
- Tu ne calcules ni n'inventes aucun chiffre : utilise UNIQUEMENT les valeurs fournies dans le JSON.
- Tu cites au maximum 4 chiffres, avec leur unité, toujours comparés à la référence donnée.
- Chaque métrique fournit une fourchette pro \`reference_fourchette_p25_p75\` et ta position \`position_vs_fourchette\`. Cette fourchette est la zone normale des pros (la moitié centrale d'entre eux).
  · \`dans_p25_p75\` = dans la norme pro : ne le présente pas comme une faiblesse.
  · \`sous_p25\` ou \`au_dessus_p75\` = hors de la fourchette : c'est là que se trouve un vrai axe de travail.
  · Regarde toujours \`sens\` (plus_est_mieux / moins_est_mieux) avant de dire si être au-dessus ou en dessous est bon.
  · \`reference_dispersion_p75_moins_p25\` indique si les pros sont homogènes (dispersion faible : un petit écart compte) ou très variables (dispersion large : un petit écart ne veut rien dire).
- Tu réponds en français, tutoiement, ton direct et exigeant mais encourageant.
- Pas de listes interminables : 3 paragraphes courts avec des titres en gras, puis 2 puces d'exercices.
- 180 à 260 mots maximum. Termine par un rappel en jeu d'une phrase.
- Si une donnée manque, tu l'ignores au lieu de l'estimer.`;

/** Construit le prompt d'un match à partir du diagnostic déterministe. */
export function buildMatchPrompt({ match, comparison, coaching }) {
  const local = match?.players?.find((p) => p.isLocal);
  const reference = comparison?.referenceLabel || comparison?.cohort?.label || 'Pros';

  const metrics = (comparison?.metrics || [])
    .filter((m) => m.higherIsBetter !== null)
    .slice(0, 14)
    .map((m) => {
      const p25 = m.reference?.p25 ?? null;
      const p75 = m.reference?.p75 ?? null;
      const hasRange = Number.isFinite(p25) && Number.isFinite(p75);
      return {
        metrique: m.label,
        valeur: m.value,
        unite: m.unit,
        // plus_est_mieux / moins_est_mieux : indispensable pour ne pas lire
        // « temps à 0 boost » comme les autres métriques.
        sens: m.higherIsBetter ? 'plus_est_mieux' : 'moins_est_mieux',
        reference_mediane: m.reference?.p50 ?? null,
        reference_fourchette_p25_p75: hasRange ? [p25, p75] : null,
        reference_dispersion_p75_moins_p25: hasRange ? Math.round((p75 - p25) * 100) / 100 : null,
        position_vs_fourchette: hasRange ? positionVsRange(m.value, p25, p75) : null,
        percentile: m.percentile,
        performance_0_100: m.performance,
      };
    });

  // Les forces/faiblesses sont déjà calculées : on leur ajoute la fourchette
  // pro pour que l'IA sache si l'écart est réellement hors norme.
  const rowsByKey = new Map((comparison?.metrics || []).map((m) => [m.key, m]));
  const withRange = (kind, entry) => {
    const row = rowsByKey.get(entry.key);
    const p25 = row?.reference?.p25 ?? null;
    const p75 = row?.reference?.p75 ?? null;
    const hasRange = Number.isFinite(p25) && Number.isFinite(p75);
    return {
      type: kind,
      metrique: entry.label,
      valeur: entry.value,
      unite: row?.unit ?? null,
      sens: row?.higherIsBetter === false ? 'moins_est_mieux' : 'plus_est_mieux',
      reference_mediane: row?.reference?.p50 ?? entry.reference ?? null,
      reference_fourchette_p25_p75: hasRange ? [p25, p75] : null,
      position_vs_fourchette: hasRange ? positionVsRange(entry.value, p25, p75) : null,
      performance_0_100: entry.performance,
    };
  };


  const context = {
    jeu: 'Rocket League',
    mode: comparison?.playlistLabel || match?.playlist || null,
    reference_comparee: reference,
    reference_type: comparison?.cohort?.mode === 'player' ? 'joueur pro unique' : 'cohorte de pros',
    reference_replays: comparison?.cohort?.replaysAnalyzed ?? null,
    resultat: match?.result || 'inconnu',
    score_equipes: match?.teamScores || null,
    duree_minutes: match?.durationSeconds ? Math.round(match.durationSeconds / 60) : null,
    score_coach_0_100: coaching?.score ?? comparison?.score ?? null,
    niveau: coaching?.level || comparison?.level || null,
    joueur: local?.name || match?.localPlayer || null,
    faiblesses: (coaching?.weaknesses || []).map((w) => withRange('faiblesse', w)),
    forces: (coaching?.strengths || []).map((s) => withRange('force', s)),
    recommandations: (coaching?.recommendations || []).slice(0, 3).map((r) => ({
      titre: r.title,
      priorite: r.priority,
      exercices: r.drills?.map((d) => d.name),
      objectif: r.target,
    })),
    metriques: metrics,
  };

  return {
    system: SYSTEM_PROMPT,
    user: `Voici le diagnostic d'un match analysé. Rédige le débriefing de coach.\n\n${JSON.stringify(
      context,
      null,
      2,
    )}\n\nStructure attendue : **Ce qui a fonctionné**, **L'axe prioritaire**, **Le plan**.`,
  };
}

/** Construit le prompt de la vue d'ensemble (plan d'entraînement). */
export function buildOverviewPrompt({ overview }) {
  const reference = overview?.referenceLabel || overview?.cohort?.label || 'Pros';

  // Fourchette pro (p25–p75) des métriques citées dans la synthèse.
  const rowsByKey = new Map((overview?.metrics || []).map((m) => [m.key, m]));
  const rangeOf = (metricKey, value) => {
    const row = rowsByKey.get(metricKey);
    if (!row) return {};
    const { p25, p75 } = row.reference || {};
    const hasRange = Number.isFinite(p25) && Number.isFinite(p75);
    return {
      reference_fourchette_p25_p75: hasRange ? [p25, p75] : null,
      position_vs_fourchette: hasRange ? positionVsRange(value, p25, p75) : null,
    };
  };
  const context = {
    jeu: 'Rocket League',
    mode: overview?.scope?.playlistLabel || null,
    matchs_analyses: overview?.scope?.matchCount ?? 0,
    minutes_jouees: overview?.scope?.minutes ?? null,
    victoires: overview?.scope?.wins ?? 0,
    defaites: overview?.scope?.losses ?? 0,
    reference_comparee: reference,
    score_coach_0_100: overview?.score ?? null,
    tendance: overview?.trend?.direction || 'inconnue',
    delta_tendance: overview?.trend?.delta ?? null,
    priorites: (overview?.priorities || []).slice(0, 4).map((p) => ({
      titre: p.title,
      priorite: p.priority,
      frequence_pourcent: p.frequency,
      diagnostic: p.diagnosis,
      objectif: p.target,
      ...rangeOf(p.target?.metricKey, p.target?.current),
    })),
    forces: (overview?.strengths || []).map((s) => ({
      metrique: s.label,
      performance: s.performance,
      ...rangeOf(s.key, s.value),
    })),
    metriques: (overview?.metrics || [])
      .filter((m) => m.higherIsBetter !== null)
      .slice(0, 10)
      .map((m) => ({
        metrique: m.label,
        valeur: m.value,
        unite: m.unit,
        sens: m.higherIsBetter ? 'plus_est_mieux' : 'moins_est_mieux',
        reference_mediane: m.reference?.p50 ?? null,
        reference_fourchette_p25_p75:
          Number.isFinite(m.reference?.p25) && Number.isFinite(m.reference?.p75)
            ? [m.reference.p25, m.reference.p75]
            : null,
        position_vs_fourchette: positionVsRange(m.value, m.reference?.p25, m.reference?.p75),
        performance_0_100: m.avgPerformance ?? m.performance ?? null,
      })),
  };

  return {
    system: SYSTEM_PROMPT,
    user: `Voici la synthèse de plusieurs matchs. Rédige un point de coach et un plan d'entraînement pour les 10 prochains matchs.\n\n${JSON.stringify(
      context,
      null,
      2,
    )}\n\nStructure attendue : **Où tu en es**, **Ce qui te bloque**, **Ton plan des 10 prochains matchs**.`,
  };
}

/**
 * Appelle une API compatible OpenAI. Ne jette jamais : renvoie un résultat.
 * @param {object} params
 * @param {object} params.config configuration résolue
 * @param {{system:string,user:string}} params.messages
 * @param {Function} [params.fetchImpl] injectable pour les tests
 */
export async function callAi({ config, messages, fetchImpl = globalThis.fetch, timeoutMs = 45000 } = {}) {
  const resolved = config?.enabled ? config : resolveAiConfig(config || {});
  if (!resolved.enabled) {
    return { ok: false, error: resolved.reason || 'Coach IA non configuré.', provider: resolved.provider, model: resolved.model };
  }

  const url = `${resolved.baseUrl}/chat/completions`;
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (resolved.apiKey) headers.Authorization = `Bearer ${resolved.apiKey}`;

  const body = JSON.stringify({
    model: resolved.model,
    messages: [
      { role: 'system', content: messages.system },
      { role: 'user', content: messages.user },
    ],
    temperature: 0.4,
    max_tokens: 800,
    stream: false,
  });

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body,
      signal: typeof AbortSignal !== 'undefined' ? AbortSignal.timeout(timeoutMs) : undefined,
    });

    if (!response.ok) {
      const detail = await safeText(response);
      const hint =
        response.status === 401 || response.status === 403
          ? 'Clé API refusée.'
          : response.status === 404
            ? 'URL ou modèle introuvable.'
            : response.status === 429
              ? 'Quota ou limite de débit atteinte.'
              : `HTTP ${response.status}.`;
      return {
        ok: false,
        error: `${hint}${detail ? ` (${detail.slice(0, 200)})` : ''}`,
        provider: resolved.provider,
        model: resolved.model,
        status: response.status,
      };
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? '';
    if (!text || typeof text !== 'string') {
      return {
        ok: false,
        error: 'Réponse inattendue de l’API IA (aucun contenu texte).',
        provider: resolved.provider,
        model: resolved.model,
      };
    }
    return {
      ok: true,
      text: text.trim(),
      provider: resolved.provider,
      model: resolved.model,
      usage: data?.usage || null,
    };
  } catch (err) {
    const message =
      err?.name === 'TimeoutError' || /aborted/i.test(err?.message || '')
        ? 'L’API IA n’a pas répondu à temps (délai dépassé).'
        : `Appel à l’API IA impossible : ${err?.message || err}`;
    return { ok: false, error: message, provider: resolved.provider, model: resolved.model };
  }
}

async function safeText(response) {
  try {
    return (await response.text()) || '';
  } catch {
    return '';
  }
}

/** Génère (ou régénère) l'analyse IA d'un match. */
export async function generateMatchNarrative({ match, comparison, coaching, config, fetchImpl } = {}) {
  const resolved = resolveAiConfig(config || {});
  if (!resolved.enabled) {
    return { ok: false, error: resolved.reason, provider: resolved.provider, model: resolved.model };
  }
  const result = await callAi({ config: resolved, messages: buildMatchPrompt({ match, comparison, coaching }), fetchImpl });
  if (!result.ok) return result;
  return {
    ...result,
    narrative: result.text,
    generatedAt: new Date().toISOString(),
    promptVersion: 1,
  };
}

/** Génère l'analyse IA de la vue d'ensemble. */
export async function generateOverviewNarrative({ overview, config, fetchImpl } = {}) {
  const resolved = resolveAiConfig(config || {});
  if (!resolved.enabled) {
    return { ok: false, error: resolved.reason, provider: resolved.provider, model: resolved.model };
  }
  const result = await callAi({ config: resolved, messages: buildOverviewPrompt({ overview }), fetchImpl });
  if (!result.ok) return result;
  return {
    ...result,
    narrative: result.text,
    generatedAt: new Date().toISOString(),
    promptVersion: 1,
  };
}

/** Test de configuration : demande une réponse minimale. */
export async function testAi({ config, fetchImpl } = {}) {
  const resolved = resolveAiConfig(config || {});
  if (!resolved.enabled) {
    return { ok: false, error: resolved.reason, provider: resolved.provider, model: resolved.model };
  }
  const result = await callAi({
    config: resolved,
    messages: { system: 'Tu réponds uniquement par le mot demandé.', user: 'Réponds exactement : OK' },
    fetchImpl,
    timeoutMs: 20000,
  });
  return {
    ...result,
    provider: resolved.provider,
    model: resolved.model,
  };
}

/** Résumé public de la configuration IA (sans la clé). */
export function publicAiStatus(config = {}) {
  const resolved = resolveAiConfig(config);
  return {
    provider: resolved.provider,
    providerLabel: AI_PROVIDERS[resolved.provider]?.label || resolved.provider,
    baseUrl: resolved.baseUrl,
    model: resolved.model,
    keySet: Boolean(resolved.apiKey),
    enabled: resolved.enabled,
    reason: resolved.reason,
    auto: Boolean(config.auto),
  };
}
