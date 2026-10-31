import { Badge, Banner, Button, Card, CardHead } from './ui.jsx';
import { Icon } from './icons.jsx';

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
