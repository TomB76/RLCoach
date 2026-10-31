import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppData } from '../hooks/useAppData.jsx';
import { useApiResource } from '../hooks/useApiResource.js';
import { api, readFileAsBase64 } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import { Badge, Banner, Button, Card, CardHead, ConfirmButton, PageHead, Spinner } from '../components/ui.jsx';
import { ReferenceSection, AiSection } from '../components/settingsSections.jsx';
import { Icon } from '../components/icons.jsx';
import { dateTime, num } from '../format.js';
import { PLAYLIST_FALLBACK } from '../metrics.js';

const FIELDS = [
  'playerName',
  'targetPlaylist',
  'host',
  'port',
  'transport',
  'autoConnect',
  'minMatchSeconds',
  'proCohortSize',
  'referenceMode',
  'referencePlayer',
  'aiProvider',
  'aiBaseUrl',
  'aiModel',
  'aiAuto',
];

const NUMERIC_FIELDS = ['port', 'minMatchSeconds', 'proCohortSize'];

function toForm(settings) {
  return {
    playerName: settings?.playerName || '',
    targetPlaylist: settings?.targetPlaylist || 'ranked-doubles',
    host: settings?.host || '127.0.0.1',
    port: String(settings?.port ?? 49123),
    transport: settings?.transport || 'ws',
    autoConnect: Boolean(settings?.autoConnect),
    minMatchSeconds: String(settings?.minMatchSeconds ?? 60),
    proCohortSize: String(settings?.proCohortSize ?? 120),
    referenceMode: settings?.referenceMode === 'player' ? 'player' : 'global',
    referencePlayer: settings?.referencePlayer || '',
    aiProvider: settings?.aiProvider || 'none',
    aiBaseUrl: settings?.aiBaseUrl || '',
    aiModel: settings?.aiModel || '',
    aiAuto: Boolean(settings?.aiAuto),
  };
}

export default function SettingsView({ navigate }) {
  const { saveSettings, clearHistory, dataVersion, status, refreshPro } = useAppData();
  const toast = useToast();
  const res = useApiResource((signal) => api.getSettings(signal), [dataVersion]);
  const settings = res.data?.settings || status?.settings || null;
  const playlists = res.data?.playlists || {};

  const [form, setForm] = useState(() => toForm(settings));
  const [baseline, setBaseline] = useState(() => toForm(settings));
  const [token, setToken] = useState('');
  const [tokenTesting, setTokenTesting] = useState(false);
  const [tokenResult, setTokenResult] = useState(null);
  const [aiKey, setAiKey] = useState('');
  const [aiTesting, setAiTesting] = useState(false);
  const [aiTestResult, setAiTestResult] = useState(null);
  const [busyAction, setBusyAction] = useState(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [clearing, setClearing] = useState(false);

  const aiProviders = res.data?.aiProviders || [];
  const playersRes = useApiResource((signal) => api.proPlayers({ playlist: form.targetPlaylist }, signal), [
    form.targetPlaylist,
    dataVersion,
  ]);
  const aiRes = useApiResource((signal) => api.aiStatus(signal), [dataVersion]);
  const aiStatus = aiRes.data?.ai || status?.ai || null;
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!settings) return;
    const next = toForm(settings);
    setForm(next);
    setBaseline(next);
  }, [settings]);

  const dirty = useMemo(() => {
    if (Object.keys(baseline).some((key) => String(form[key]) !== String(baseline[key]))) return true;
    return token.trim().length > 0 || aiKey.trim().length > 0;
  }, [form, baseline, token, aiKey]);

  const tokenSet = Boolean(settings?.ballchasingTokenSet);
  const aiKeySet = Boolean(settings?.aiApiKeySet);
  const matchCount = status?.storage?.matchCount ?? 0;
  const referenceInfo = res.data?.reference || status?.ballchasing?.reference || null;
  const cohortInfo = status?.ballchasing?.cohort || null;
  const referenceDirty =
    form.referenceMode !== baseline.referenceMode ||
    String(form.referencePlayer) !== String(baseline.referencePlayer);

  function update(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function buildPatch(keys) {
    const patch = {};
    for (const key of keys) {
      if (String(form[key]) === String(baseline[key])) continue;
      patch[key] = NUMERIC_FIELDS.includes(key) ? Number(form[key]) : form[key];
    }
    return patch;
  }

  async function handleSave(event) {
    event.preventDefault();
    const patch = buildPatch(FIELDS);
    if (token.trim()) patch.ballchasingToken = token.trim();
    if (aiKey.trim()) patch.aiApiKey = aiKey.trim();
    if (!Object.keys(patch).length) return;
    setSaving(true);
    try {
      const result = await saveSettings(patch);
      const next = toForm(result?.settings);
      setToken('');
      setAiKey('');
      setTokenResult(null);
      setAiTestResult(null);
      setBaseline(next);
      setForm(next);
      aiRes.reload();
      const reanalyzed = Number(result?.reanalyzed) || 0;
      toast.push({
        kind: 'success',
        title: 'Réglages enregistrés',
        message:
          reanalyzed > 0
            ? `${reanalyzed} match(s) réanalysés avec la nouvelle référence.`
            : 'Les changements sont appliqués immédiatement côté serveur.',
      });
    } catch (error) {
      toast.push({ kind: 'error', title: 'Enregistrement impossible', message: error.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleTestToken() {
    setTokenTesting(true);
    setTokenResult(null);
    try {
      const result = await api.testToken(token.trim());
      setTokenResult({ ok: true, message: result?.login ? `Token valide (compte ${result.login}).` : 'Token valide.' });
    } catch (error) {
      setTokenResult({ ok: false, message: error.message });
    } finally {
      setTokenTesting(false);
    }
  }
  async function handleApplyReference() {
    setBusyAction('apply');
    try {
      const result = await saveSettings({
        referenceMode: form.referenceMode,
        referencePlayer: String(form.referencePlayer || '').trim(),
      });
      const next = toForm(result?.settings);
      setBaseline((prev) => ({ ...prev, referenceMode: next.referenceMode, referencePlayer: next.referencePlayer }));
      setForm((prev) => ({ ...prev, referenceMode: next.referenceMode, referencePlayer: next.referencePlayer }));
      const reanalyzed = Number(result?.reanalyzed) || 0;
      const appliedLabel =
        result?.status?.ballchasing?.reference?.label ||
        result?.reference?.label ||
        (next.referenceMode === 'player' ? next.referencePlayer || 'joueur pro' : 'cohorte globale');
      toast.push({
        kind: 'success',
        title: 'Référence appliquée',
        message:
          reanalyzed > 0
            ? `${reanalyzed} match(s) réanalysés avec « ${appliedLabel} ».`
            : 'Aucun match à réanalyser pour le moment.',
      });
    } catch (error) {
      toast.push({ kind: 'error', title: 'Changement de référence impossible', message: error.message });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRefreshPlayer() {
    const player = String(form.referencePlayer || '').trim();
    if (!player) return;
    setBusyAction('player-refresh');
    try {
      await refreshPro({
        playlist: form.targetPlaylist,
        mode: 'player',
        player,
        size: Number(form.proCohortSize) || 40,
      });
      toast.push({
        kind: 'info',
        title: 'Actualisation lancée',
        message: `Récupération des replays de ${player} : la progression s’affiche sur la page Référence pro.`,
      });
    } catch (error) {
      toast.push({ kind: 'error', title: 'Actualisation impossible', message: error.message });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleTestAi() {
    setAiTesting(true);
    setAiTestResult(null);
    try {
      const payload = { provider: form.aiProvider };
      if (form.aiBaseUrl) payload.baseUrl = form.aiBaseUrl;
      if (form.aiModel) payload.model = form.aiModel;
      if (aiKey.trim()) payload.apiKey = aiKey.trim();
      const result = await api.testAi(payload);
      const label = aiProviders.find((item) => item.id === (result?.provider || form.aiProvider))?.label;
      setAiTestResult({ ok: true, provider: result?.provider, providerLabel: label, model: result?.model });
    } catch (error) {
      setAiTestResult({ ok: false, message: error.message });
    } finally {
      setAiTesting(false);
    }
  }

  async function handleFile(file) {
    if (!file) return;
    setImportError(null);
    if (!/\.replay$/i.test(file.name)) {
      setImportError('Seuls les fichiers .replay de Rocket League sont acceptés.');
      return;
    }
    setImporting(true);
    try {
      const base64 = await readFileAsBase64(file);
      const result = await api.importReplay({ fileName: file.name, dataBase64: base64 });
      toast.push({ kind: 'success', title: 'Replay analysé', message: result?.summary?.rlCoachScore != null ? `Score coach ${result.summary.rlCoachScore}/100 (${result.summary.grade}).` : file.name });
      if (result?.match?.id) navigate(`/match/${result.match.id}`);
    } catch (error) {
      setImportError(error.message);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleClearHistory() {
    setClearing(true);
    try {
      await clearHistory();
      toast.push({ kind: 'success', title: 'Historique vidé' });
    } catch (error) {
      toast.push({ kind: 'error', title: 'Suppression impossible', message: error.message });
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="page">
      <PageHead
        eyebrow="Configuration"
        title="Réglages"
        subtitle="Ton pseudo, l’accès ballchasing, la connexion à l’API Stats du jeu et l’import de replays."
        actions={dirty ? <Badge tone="warn" dot>modifications non enregistrées</Badge> : <Badge tone="ok" dot>à jour</Badge>}
      />

      {res.error ? <Banner tone="danger" title="Impossible de charger les réglages">{res.error}</Banner> : null}

      <form className="settings" onSubmit={handleSave}>
        <Card>
          <CardHead title="Profil joueur" hint="Le pseudo doit correspondre exactement à ton nom in-game pour que tes stats soient identifiées." />
          <div className="form-grid">
            <div className="field">
              <label className="field__label" htmlFor="playerName">Pseudo in-game</label>
              <input id="playerName" className="input" value={form.playerName} onChange={(event) => update('playerName', event.target.value)} placeholder="Ex. Tom" autoComplete="off" />
              <p className="field__hint">Utilisé pour trouver ta ligne dans chaque match.</p>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="targetPlaylist">Mode de jeu de référence</label>
              <select id="targetPlaylist" className="input" value={form.targetPlaylist} onChange={(event) => update('targetPlaylist', event.target.value)}>
                {Object.entries(playlists).map(([key, entry]) => (
                  <option key={key} value={key}>{entry.label}</option>
                ))}
                {!Object.keys(playlists).length
                  ? Object.entries(PLAYLIST_FALLBACK).map(([key, entry]) => <option key={key} value={key}>{entry.label}</option>)
                  : null}
              </select>
              <p className="field__hint">Mode utilisé pour la cohorte pro et les comparaisons.</p>
            </div>
          </div>
        </Card>
        <ReferenceSection
          form={form}
          update={update}
          playlists={playlists}
          reference={status?.ballchasing?.reference || referenceInfo}
          cohortLabel={cohortInfo?.label}
          playerAvailable={cohortInfo?.playerAvailable ?? null}
          players={playersRes.data}
          playersLoading={playersRes.loading}
          playersError={playersRes.error}
          tokenSet={tokenSet}
          busy={busyAction}
          referenceDirty={referenceDirty}
          onApply={handleApplyReference}
          onRefreshPlayer={handleRefreshPlayer}
          targetPlaylist={form.targetPlaylist}
        />

        <Card>
          <CardHead
            title="Token ballchasing"
            hint="Nécessaire pour construire une vraie cohorte pro et importer des replays."
            actions={<Badge tone={tokenSet ? 'ok' : 'warn'} dot>{tokenSet ? 'token enregistré' : 'aucun token'}</Badge>}
          />
          <div className="form-row form-row--end">
            <div className="field field--grow">
              <label className="field__label" htmlFor="token">Token API</label>
              <input
                id="token"
                className="input"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder={tokenSet ? 'Token enregistré — laisse vide pour le conserver' : 'Colle ton token ballchasing'}
                autoComplete="off"
                spellCheck="false"
              />
              <p className="field__hint">Le token n’est jamais renvoyé en clair par le serveur.</p>
            </div>
            <Button variant="ghost" icon="check" loading={tokenTesting} disabled={!token.trim() && !tokenSet} onClick={handleTestToken}>
              Tester le token
            </Button>
            <a className="btn btn--ghost" href="https://ballchasing.com/account" target="_blank" rel="noreferrer noopener">
              <Icon name="external" size={15} />
              <span>ballchasing.com</span>
            </a>
          </div>
          {tokenResult ? (
            <Banner tone={tokenResult.ok ? 'ok' : 'danger'} title={tokenResult.ok ? 'Token accepté' : 'Token refusé'}>
              {tokenResult.message}
            </Banner>
          ) : null}
        </Card>
        <AiSection
          form={form}
          update={update}
          providers={aiProviders}
          apiKey={aiKey}
          setApiKey={setAiKey}
          keySet={aiKeySet}
          aiStatus={aiStatus}
          testing={aiTesting}
          testResult={aiTestResult}
          onTest={handleTestAi}
        />

        <Card>
          <CardHead title="API Stats de Rocket League" hint="Le jeu expose ses statistiques en local quand il tourne." />
          <div className="form-grid form-grid--three">
            <div className="field">
              <label className="field__label" htmlFor="host">Hôte</label>
              <input id="host" className="input" value={form.host} onChange={(event) => update('host', event.target.value)} spellCheck="false" />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="port">Port</label>
              <input id="port" className="input" value={form.port} inputMode="numeric" onChange={(event) => update('port', event.target.value.replace(/[^\d]/g, ''))} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="transport">Transport</label>
              <select id="transport" className="input" value={form.transport} onChange={(event) => update('transport', event.target.value)}>
                <option value="ws">WebSocket</option>
                <option value="tcp">TCP</option>
              </select>
            </div>
          </div>
          <div className="form-grid form-grid--three">
            <div className="field">
              <label className="field__label" htmlFor="minMatchSeconds">Durée minimale d’un match (s)</label>
              <input id="minMatchSeconds" className="input" value={form.minMatchSeconds} inputMode="numeric" onChange={(event) => update('minMatchSeconds', event.target.value.replace(/[^\d]/g, ''))} />
              <p className="field__hint">En dessous, le match est ignoré (forfait, échauffement).</p>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="proCohortSize">Replays pros ciblés</label>
              <input id="proCohortSize" className="input" value={form.proCohortSize} inputMode="numeric" onChange={(event) => update('proCohortSize', event.target.value.replace(/[^\d]/g, ''))} />
              <p className="field__hint">Nombre de replays agrégés lors d’une actualisation.</p>
            </div>
            <div className="field field--switch">
              <label className="switch">
                <input type="checkbox" checked={form.autoConnect} onChange={(event) => update('autoConnect', event.target.checked)} />
                <span className="switch__track" aria-hidden="true"><span className="switch__thumb" /></span>
                <span className="switch__label">Connexion automatique au démarrage</span>
              </label>
            </div>
          </div>
        </Card>

        <div className="settings__actions">
          <Button variant="primary" type="submit" icon="check" loading={saving} disabled={!dirty}>
            Enregistrer les réglages
          </Button>
          {dirty ? (
            <Button variant="ghost" onClick={() => { setForm(baseline); setToken(''); setTokenResult(null); }}>
              Annuler les modifications
            </Button>
          ) : (
            <span className="muted">Aucune modification en attente.</span>
          )}
        </div>
      </form>

      <Card>
        <CardHead
          title="Importer un replay"
          hint="Le fichier est envoyé à ballchasing pour analyse, puis ajouté à ton historique."
          actions={tokenSet ? null : <Badge tone="warn">token requis</Badge>}
        />
        <div
          className={`dropzone${dragging ? ' is-dragging' : ''}${!tokenSet ? ' is-disabled' : ''}`}
          onDragOver={(event) => { event.preventDefault(); if (tokenSet) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (!tokenSet) return;
            handleFile(event.dataTransfer?.files?.[0]);
          }}
        >
          <input
            ref={fileInputRef}
            id="replay-file"
            type="file"
            accept=".replay"
            className="sr-only"
            disabled={!tokenSet || importing}
            onChange={(event) => handleFile(event.target.files?.[0])}
          />
          {importing ? (
            <span className="inline-loading"><Spinner size={20} /><span>Analyse du replay…</span></span>
          ) : (
            <>
              <Icon name="upload" size={22} />
              <p className="dropzone__title">Glisse un fichier <strong>.replay</strong> ici</p>
              <label htmlFor="replay-file" className={`btn btn--ghost btn--sm${!tokenSet ? ' is-disabled' : ''}`}>
                <span>Parcourir…</span>
              </label>
              {!tokenSet ? <p className="field__hint">Ajoute d’abord un token ballchasing.</p> : null}
            </>
          )}
        </div>
        {importError ? <Banner tone="danger" title="Import impossible">{importError}</Banner> : null}
        <p className="hint-text">
          Replays locaux : <code>Documents\My Games\Rocket League\TAGame\Demos</code>. L’upload se fait en visibilité « unlisted ».
        </p>
      </Card>

      <Card tone="danger">
        <CardHead title="Zone de danger" hint="Ces actions sont immédiates et irréversibles." actions={<Badge tone="danger">{num(matchCount, 0)} match(s)</Badge>} />
        <div className="danger-row">
          <div>
            <p className="danger-row__title">Vider l’historique des matchs</p>
            <p className="muted">
              Supprime les {num(matchCount, 0)} match(s) analysés et tes scores. Les réglages et la cohorte pro sont conservés.
              {status?.storage?.lastMatchAt ? ` Dernier match : ${dateTime(status.storage.lastMatchAt)}.` : ''}
            </p>
          </div>
          <ConfirmButton
            label="Vider l’historique"
            confirmLabel="Confirmer la suppression"
            onConfirm={handleClearHistory}
            busy={clearing}
            disabled={!matchCount}
          />
        </div>
        <p className="hint-text">Données stockées dans {status?.storage?.dataDir || 'le dossier data/'}.</p>
      </Card>
    </div>
  );
}
