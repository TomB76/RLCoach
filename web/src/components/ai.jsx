import { Badge, Banner, Button, Card, CardHead, SkeletonBlock } from './ui.jsx';
import { Icon } from './icons.jsx';
import { Narrative } from './narrative.jsx';
import { dateTime } from '../format.js';

/**
 * Carte du coach IA : affiche la narration existante, propose de la générer,
 * et explique clairement pourquoi le bouton est indisponible le cas échéant.
 * Le diagnostic déterministe reste la source de vérité : l'IA ne fait que rédiger.
 */
export function AiCoachCard({
  title = 'Debriefing du coach IA',
  hint = 'Rédaction du diagnostic déjà calculé : aucun chiffre n’est inventé par le modèle.',
  ai = null,
  loading = false,
  error = null,
  onGenerate,
  enabled = false,
  reason = null,
  idleLabel = 'Générer l’analyse IA',
  regenerateLabel = 'Régénérer',
  idleDescription = 'Le coach IA reformule le diagnostic de ce match en un débriefing de coach.',
  generatedWith = null,
}) {
  const provider = ai?.provider || generatedWith?.provider || null;
  const model = ai?.model || generatedWith?.model || null;
  const state = ai ? { tone: 'info', label: 'narration générée' } : enabled ? { tone: 'ok', label: 'IA configurée' } : { tone: 'neutral', label: 'IA désactivée' };

  return (
    <Card className="ai-card">
      <CardHead
        title={title}
        icon="live"
        hint={hint}
        actions={
          <Badge tone={state.tone} dot>
            {state.label}
          </Badge>
        }
      />

      {ai?.narrative ? (
        <>
          <Narrative text={ai.narrative} />
          <dl className="ai-meta">
            <div>
              <dt>Modèle</dt>
              <dd>{[provider, model].filter(Boolean).join(' · ') || 'non précisé'}</dd>
            </div>
            {ai.referenceLabel ? (
              <div>
                <dt>Référence</dt>
                <dd>{ai.referenceLabel}</dd>
              </div>
            ) : null}
            <div>
              <dt>Généré</dt>
              <dd>{ai.generatedAt ? dateTime(ai.generatedAt) : '—'}</dd>
            </div>
          </dl>
          <div className="card__foot">
            {enabled ? (
              <Button icon="refresh" loading={loading} onClick={onGenerate}>
                {regenerateLabel}
              </Button>
            ) : (
              <span className="muted">{reason || 'Coach IA désactivé : la narration ne peut pas être régénérée.'}</span>
            )}
            <span className="ai-disclaimer">
              <Icon name="info" size={14} />
              <span>Diagnostic déterministe = source de vérité. L’IA ne fait que rédiger.</span>
            </span>
          </div>
        </>
      ) : loading ? (
        <SkeletonBlock rows={5} />
      ) : !enabled ? (
        <>
          <Banner
            tone="info"
            title="Coach IA non configuré"
            action={
              <a className="btn btn--ghost btn--sm" href="#/reglages">
                <Icon name="settings" size={15} />
                <span>Réglages</span>
              </a>
            }
          >
            {reason || 'Choisis un fournisseur (OpenAI, Ollama local ou endpoint compatible) dans les réglages pour activer la rédaction.'}
          </Banner>
          <p className="ai-disclaimer">
            <Icon name="info" size={14} />
            <span>Le diagnostic chiffré reste calculé localement : l’IA ne fait que rédiger.</span>
          </p>
        </>
      ) : (
        <>
          <p className="ai-idle">{idleDescription}</p>
          <div className="card__foot">
            <Button variant="primary" icon="live" loading={loading} onClick={onGenerate}>
              {idleLabel}
            </Button>
            <span className="ai-disclaimer">
              <Icon name="info" size={14} />
              <span>Le diagnostic déterministe reste la source de vérité.</span>
            </span>
          </div>
        </>
      )}

      {error ? (
        <Banner tone="danger" title="Analyse IA impossible">
          {error}
        </Banner>
      ) : null}
    </Card>
  );
}
