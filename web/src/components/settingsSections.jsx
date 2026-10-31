import { Badge, Banner, Button, Card, CardHead, Segmented, SkeletonBlock } from './ui.jsx';
import { Icon } from './icons.jsx';
import { num, relative } from '../format.js';

/** Section « Référence de coaching » des réglages. */
export function ReferenceSection({
  form,
  update,
  playlists,
  reference,
  cohortLabel,
  playerAvailable,
  players,
  playersLoading,
  playersError,
  tokenSet,
  busy,
  referenceDirty,
  onApply,
  onRefreshPlayer,
  targetPlaylist,
}) {
  const mode = form.referenceMode === 'player' ? 'player' : 'global';
  const player = (form.referencePlayer || '').trim();
  const known = players?.players || [];
  const suggestions = players?.suggestions || [];
  const activeLabel = reference?.label || cohortLabel || 'Pros (cohorte globale)';

  return (
    <Card>
      <CardHead
        title="Référence de coaching"
        icon="pro"
        hint="À qui te comparer : la cohorte de tous les pros, ou les replays d’un seul joueur."
        actions={<Badge tone={mode === 'player' ? 'accent' : 'info'}>active : {activeLabel}</Badge>}
      />

      <Segmented
        label="Mode de référence"
        value={mode}
        onChange={(value) => update('referenceMode', value)}
        options={[
          { value: 'global', label: 'Cohorte globale', hint: 'tous les pros' },
          { value: 'player', label: 'Joueur pro', hint: 'un seul joueur' },
        ]}
      />

      {mode === 'player' ? (
        <>
          <div className="field">
            <label className="field__label" htmlFor="referencePlayer">
              Nom du joueur pro (pseudo ballchasing exact)
            </label>
            <input
              id="referencePlayer"
              className="input"
              value={form.referencePlayer || ''}
              onChange={(event) => update('referencePlayer', event.target.value)}
              placeholder="Ex. Vatira"
              list="pro-player-suggestions"
              autoComplete="off"
              spellCheck="false"
            />
            <datalist id="pro-player-suggestions">
              {suggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <p className="field__hint">
              Suggestions de saisie uniquement : la référence n’existe qu’après récupération de ses replays via ballchasing.
            </p>
          </div>

          {playersError ? (
            <Banner tone="danger" title="Impossible de charger les pros connus">
              {playersError}
            </Banner>
          ) : playersLoading && !players ? (
            <SkeletonBlock rows={3} />
          ) : known.length ? (
            <div className="known-players">
              <p className="known-players__title">
                Pros rencontrés dans la cohorte globale ({num(known.length, 0)})
                {players?.updatedAt ? <span className="muted"> · {relative(players.updatedAt)}</span> : null}
              </p>
              <ul className="known-players__list">
                {known.slice(0, 12).map((entry) => (
                  <li key={entry.name}>
                    <button
                      type="button"
                      className={`chip${player.toLowerCase() === String(entry.name).toLowerCase() ? ' is-active' : ''}`}
                      onClick={() => update('referencePlayer', entry.name)}
                    >
                      {entry.name}
                      <span className="chip__count">
                        {num(entry.cohortReplays ?? entry.replays, 0)} replay{(entry.cohortReplays ?? entry.replays) > 1 ? 's' : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="known-players">
              <p className="known-players__title">
                Aucun pro reconnu dans la cohorte globale en cache
                <span className="muted"> ({players?.source || 'aucune cohorte globale'})</span>
              </p>
              <ul className="known-players__list">
                {suggestions.slice(0, 12).map((name) => (
                  <li key={name}>
                    <button
                      type="button"
                      className={`chip${player.toLowerCase() === name.toLowerCase() ? ' is-active' : ''}`}
                      onClick={() => update('referencePlayer', name)}
                      title="Suggestion de saisie"
                    >
                      {name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {mode === 'player' && player && playerAvailable === false ? (
            <Banner tone="warn" title={`Aucune donnée pour « ${player} »`}>
              Aucun replay de ce joueur n’a encore été analysé : les repères de démarrage sont utilisés. Lance une actualisation
              pour construire sa référence.
            </Banner>
          ) : null}
        </>
      ) : (
        <p className="hint-text">
          La cohorte globale agrège les replays de tous les pros récupérés pour ce mode
          {targetPlaylist ? ` (${targetPlaylist})` : ''}.
        </p>
      )}

      <div className="form-row form-row--end">
        <Button variant="primary" icon="check" loading={busy === 'apply'} disabled={!referenceDirty} onClick={onApply}>
          Appliquer cette référence
        </Button>
        <Button
          icon="refresh"
          loading={busy === 'player-refresh'}
          disabled={mode !== 'player' || !player || !tokenSet}
          onClick={onRefreshPlayer}
          title={tokenSet ? undefined : 'Un token ballchasing est nécessaire'}
        >
          Actualiser les replays de ce joueur
        </Button>
        {mode === 'player' && !tokenSet ? (
          <span className="field__hint">
            Token ballchasing requis — <a href="https://ballchasing.com/account" target="_blank" rel="noreferrer noopener">en obtenir un</a>.
          </span>
        ) : null}
      </div>

      <p className="hint-text">
        Changer de référence réanalyse tout ton historique avec la nouvelle base de comparaison : les scores et les priorités
        sont recalculés.
      </p>
    </Card>
  );
}

/** Section « Coach IA » des réglages. */
export function AiSection({
  form,
  update,
  providers = [],
  apiKey,
  setApiKey,
  keySet = false,
  aiStatus,
  testing,
  testResult,
  onTest,
}) {
  const providerId = form.aiProvider || 'none';
  const provider = providers.find((item) => item.id === providerId) || { id: 'none', label: 'Désactivé' };
  const disabled = providerId === 'none';
  const savedMatchesForm = (aiStatus?.provider || 'none') === providerId;
  const active = Boolean(aiStatus?.enabled) && savedMatchesForm;
  const reason = savedMatchesForm ? aiStatus?.reason || null : null;
  const badge = active
    ? { tone: 'ok', label: `actif · ${aiStatus.model || provider.defaultModel || 'modèle'}` }
    : disabled
      ? { tone: 'neutral', label: 'désactivé' }
      : { tone: savedMatchesForm ? 'warn' : 'info', label: savedMatchesForm ? 'à compléter' : 'non enregistré' };

  return (
    <Card>
      <CardHead
        title="Coach IA"
        icon="live"
        hint="Rédaction du diagnostic existant par une API compatible OpenAI. Désactivé par défaut : aucun appel réseau sans configuration."
        actions={
          <Badge tone={badge.tone} dot>
            {badge.label}
          </Badge>
        }
      />

      <div className="form-grid">
        <div className="field">
          <label className="field__label" htmlFor="aiProvider">
            Fournisseur
          </label>
          <select
            id="aiProvider"
            className="input"
            value={providerId}
            onChange={(event) => update('aiProvider', event.target.value)}
          >
            {providers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <p className="field__hint">OpenAI, Ollama local, ou n’importe quel endpoint compatible OpenAI.</p>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="aiModel">
            Modèle
          </label>
          <input
            id="aiModel"
            className="input"
            value={form.aiModel || ''}
            onChange={(event) => update('aiModel', event.target.value)}
            placeholder={provider.defaultModel || 'ex. gpt-4o-mini'}
            disabled={disabled}
            spellCheck="false"
            autoComplete="off"
          />
          <p className="field__hint">{provider.defaultModel ? `Défaut : ${provider.defaultModel}` : 'Requis pour appeler l’API.'}</p>
        </div>
      </div>

      <div className="form-grid">
        <div className="field">
          <label className="field__label" htmlFor="aiBaseUrl">
            URL de base
          </label>
          <input
            id="aiBaseUrl"
            className="input"
            value={form.aiBaseUrl || ''}
            onChange={(event) => update('aiBaseUrl', event.target.value)}
            placeholder={provider.defaultBaseUrl || 'https://api.openai.com/v1'}
            disabled={disabled}
            spellCheck="false"
            autoComplete="off"
          />
          <p className="field__hint">{provider.defaultBaseUrl ? `Défaut : ${provider.defaultBaseUrl}` : 'Le chemin /chat/completions est ajouté automatiquement.'}</p>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="aiApiKey">
            Clé API
          </label>
          <input
            id="aiApiKey"
            className="input"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={keySet ? 'Clé enregistrée — laisse vide pour la conserver' : provider.requiresKey ? 'Requise pour ce fournisseur' : 'Facultative'}
            disabled={disabled}
            autoComplete="off"
            spellCheck="false"
          />
          <p className="field__hint">Jamais réaffichée : le serveur ne renvoie qu’un booléen.</p>
        </div>
      </div>

      <label className="switch">
        <input
          type="checkbox"
          checked={Boolean(form.aiAuto)}
          onChange={(event) => update('aiAuto', event.target.checked)}
          disabled={disabled}
        />
        <span className="switch__track" aria-hidden="true">
          <span className="switch__thumb" />
        </span>
        <span className="switch__label">Générer automatiquement le débriefing après chaque match analysé</span>
      </label>

      {!disabled && reason ? (
        <Banner tone="warn" title="Configuration incomplète">
          {reason}
        </Banner>
      ) : null}

      <div className="form-row form-row--end">
        <Button icon="check" loading={testing} disabled={disabled} onClick={onTest}>
          Tester la configuration
        </Button>
        <span className="ai-disclaimer">
          <Icon name="info" size={14} />
          <span>Le diagnostic déterministe reste la source de vérité ; l’IA ne fait que rédiger.</span>
        </span>
      </div>

      {testResult ? (
        <Banner
          tone={testResult.ok ? 'ok' : 'danger'}
          title={testResult.ok ? 'Configuration acceptée' : 'Test impossible'}
        >
          {testResult.ok
            ? `Réponse reçue de ${testResult.providerLabel || testResult.provider}${testResult.model ? ` (${testResult.model})` : ''}.`
            : testResult.message}
        </Banner>
      ) : null}

      <p className="hint-text">
        Le bouton « Tester » utilise la configuration affichée dans ce formulaire, même non enregistrée. Aucune requête n’est
        envoyée quand le fournisseur est « Désactivé ».
      </p>
    </Card>
  );
}
