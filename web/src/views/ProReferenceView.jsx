import { useMemo, useState } from 'react';
import { useAppData } from '../hooks/useAppData.jsx';
import { useApiResource } from '../hooks/useApiResource.js';
import { api } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import { Badge, Banner, Button, Card, CardHead, EmptyState, Meter, PageHead, Segmented, SkeletonBlock } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';
import { SpreadBar } from '../components/charts.jsx';
import { metric as fmtMetric, num, relative } from '../format.js';
import { METRICS, METRIC_GROUPS, METRIC_GROUP_ORDER, playlistLabel } from '../metrics.js';

const SOURCE_LABELS = {
  ballchasing: 'ballchasing.com',
  seed: 'repères de démarrage',
  cache: 'cache local',
};

const SIZES = [20, 40, 80, 120];

export default function ProReferenceView() {
  const { status, playlists, dataVersion, proRefresh, refreshPro, saveSettings, bumpData } = useAppData();
  const toast = useToast();
  // Plus de doublon : la référence enregistrée côté serveur est l'unique source
  // de vérité, et cet écran est le seul endroit où on la choisit. Les états
  // locaux ne servent qu'à la saisie en cours.
  const [editMode, setEditMode] = useState(null);
  const [playerDraft, setPlayerDraft] = useState(null);
  const [size, setSize] = useState(40);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);

  const activeRef = status?.ballchasing?.reference || { mode: 'global', player: null, label: 'Pros (cohorte globale)' };
  const scope = status?.settings?.targetPlaylist || 'ranked-doubles';
  const effectiveMode = activeRef.mode === 'player' ? 'player' : 'global';
  const effectivePlayer = activeRef.player || '';
  const draftMode = editMode || effectiveMode;
  const draftPlayer = playerDraft ?? effectivePlayer;
  const tokenSet = Boolean(status?.ballchasing?.tokenSet);

  const playersRes = useApiResource((signal) => api.proPlayers({ playlist: scope }, signal), [scope, dataVersion]);
  const known = playersRes.data?.players || [];
  const suggestions = playersRes.data?.suggestions || [];
  // On ne propose que les joueurs dont une cohorte a déjà été mesurée : les
  // autres pseudos de la cohorte globale ne sont pas des pros (cf. pro=true).
  const measured = known.filter((entry) => entry.hasCohort);

  const res = useApiResource(
    async (signal) => {
      if (effectiveMode === 'player' && !String(effectivePlayer).trim()) return { reference: null, overview: null };
      const [reference, overview] = await Promise.all([
        api.proReference(
          { playlist: scope, mode: effectiveMode, player: effectiveMode === 'player' ? String(effectivePlayer).trim() : undefined },
          signal,
        ),
        api.overview({ limit: 15, playlist: scope }, signal).catch(() => null),
      ]);
      return { reference, overview: overview?.overview || null };
    },
    [scope, effectiveMode, effectivePlayer, dataVersion],
  );

  const cohort = res.data?.reference?.cohort || null;
  const storedRefresh = res.data?.reference?.refresh || null;
  const liveRefresh =
    proRefresh && (!proRefresh.playlist || proRefresh.playlist === scope) ? proRefresh : null;
  const refresh = liveRefresh || storedRefresh;
  const metrics = cohort?.metrics || {};
  const needsPlayer = effectiveMode === 'player' && !String(effectivePlayer).trim();

  const myValues = useMemo(() => {
    const map = new Map();
    for (const row of res.data?.overview?.metrics || []) map.set(row.key, row.value);
    return map;
  }, [res.data]);

  const rows = useMemo(() => METRICS.filter((metric) => metrics[metric.key]), [metrics]);
  const groups = useMemo(
    () => METRIC_GROUP_ORDER.map((group) => [group, rows.filter((row) => row.group === group)]).filter(([, list]) => list.length),
    [rows],
  );

  const running = Boolean(refresh?.running);
  const progressPercent = refresh?.total ? Math.min(100, ((refresh.done || 0) / refresh.total) * 100) : 0;
  const draftApplied =
    draftMode === effectiveMode &&
    (draftMode === 'global' ||
      String(draftPlayer).trim().toLowerCase() === String(effectivePlayer).trim().toLowerCase());

  /** Applique et enregistre la référence : le seul geste de décision de l'app. */
  async function applyPlayer(name) {
    const clean = String(name || '').trim();
    if (!clean) return;
    setApplying(true);
    try {
      const result = await saveSettings({ referenceMode: 'player', referencePlayer: clean });
      setPlayerDraft(clean);
      setEditMode('player');
      bumpData();
      const reanalyzed = Number(result?.reanalyzed) || 0;
      toast.push({
        kind: 'success',
        title: 'Référence appliquée',
        message:
          reanalyzed > 0
            ? `${reanalyzed} match(s) réanalysés avec « ${clean} ». Récupère ses replays pour construire sa cohorte.`
            : `« ${clean} » est désormais la référence de coaching.`,
      });
    } catch (error) {
      toast.push({ kind: 'error', title: 'Changement de référence impossible', message: error.message });
    } finally {
      setApplying(false);
    }
  }

  /** Change le type de référence : la cohorte globale s'applique tout de suite. */
  async function applyMode(value) {
    if (value !== 'global') {
      setEditMode('player');
      if (!playerDraft && effectivePlayer) setPlayerDraft(effectivePlayer);
      return;
    }
    setEditMode('global');
    setApplying(true);
    try {
      await saveSettings({ referenceMode: 'global' });
      bumpData();
      toast.push({ kind: 'success', title: 'Référence appliquée', message: 'Cohorte globale : tous les pros agrégés.' });
    } catch (error) {
      toast.push({ kind: 'error', title: 'Changement de référence impossible', message: error.message });
    } finally {
      setApplying(false);
    }
  }

  /** Change le mode de jeu comparé : enregistré, donc réanalysé. */
  async function applyPlaylist(value) {
    if (value === scope) return;
    setApplying(true);
    try {
      await saveSettings({ targetPlaylist: value });
      bumpData();
    } catch (error) {
      toast.push({ kind: 'error', title: 'Changement de mode impossible', message: error.message });
    } finally {
      setApplying(false);
    }
  }

  async function handleRefresh() {
    setBusy(true);
    try {
      await refreshPro({
        playlist: scope,
        mode: effectiveMode,
        player: effectiveMode === 'player' ? String(effectivePlayer).trim() : undefined,
        size,
      });
      toast.push({
        kind: 'info',
        title: 'Actualisation lancée',
        message:
          effectiveMode === 'player'
            ? `${size} replays de ${effectivePlayer} vont être analysés via ballchasing. La progression s’affiche ici.`
            : `${size} replays pros vont être analysés via ballchasing. La progression s’affiche ici.`,
      });
    } catch (error) {
      toast.push({ kind: 'error', title: 'Actualisation impossible', message: error.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHead
        eyebrow="Cohorte"
        title="Référence pro"
        subtitle="La base de comparaison utilisée par le coach : tous les pros, ou les replays d’un seul joueur."
        actions={
          <div className="head-status">
            <div className="field field--inline">
              <label className="field__label" htmlFor="pro-playlist">Mode</label>
              <select
                id="pro-playlist"
                className="input input--sm"
                value={scope}
                disabled={applying}
                onChange={(event) => applyPlaylist(event.target.value)}
              >
                {Object.entries(playlists || {}).map(([key, entry]) => (
                  <option key={key} value={key}>{entry.label}</option>
                ))}
              </select>
            </div>
            <Button size="sm" icon="refresh" onClick={res.reload} loading={res.loading}>Recharger</Button>
          </div>
        }
      />

      <Card>
        <CardHead
          title="Référence appliquée"
          icon="pro"
          hint="C’est la base de comparaison utilisée par le coach sur tout ton historique ; le changement est enregistré."
          actions={
            <div className="head-status">
              <Badge tone={draftApplied ? 'ok' : 'warn'} dot>
                {draftApplied ? 'active' : 'non appliquée'} :{' '}
                {activeRef.label || (effectiveMode === 'player' ? effectivePlayer : 'Pros (cohorte globale)')}
              </Badge>
            </div>
          }
        />

        <Segmented
          label="Type de référence"
          value={draftMode}
          onChange={applyMode}
          options={[
            { value: 'global', label: 'Cohorte globale', hint: 'tous les pros' },
            { value: 'player', label: 'Joueur pro', hint: 'un seul joueur' },
          ]}
        />

        {effectiveMode === 'player' ? (
          <div className="reference-picker">
            <div className="field">
              <label className="field__label" htmlFor="pro-player">Joueur pro</label>
              <input
                id="pro-player"
                className="input"
                value={draftPlayer}
                list="pro-reference-suggestions"
                placeholder="Ex. Vatira"
                autoComplete="off"
                spellCheck="false"
                onChange={(event) => setPlayerDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    applyPlayer(draftPlayer.trim());
                  }
                }}
              />
              <datalist id="pro-reference-suggestions">
                {suggestions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="pro-player-known">
                Joueurs avec une cohorte mesurée ({num(measured.length, 0)})
              </label>
              <select
                id="pro-player-known"
                className="input"
                value={measured.some((entry) => entry.name === draftPlayer) ? draftPlayer : ''}
                onChange={(event) => {
                  if (event.target.value) applyPlayer(event.target.value);
                }}
                disabled={!measured.length || applying}
              >
                <option value="">{measured.length ? 'Choisir un joueur…' : 'Aucune cohorte de joueur mesurée'}</option>
                {measured.map((entry) => (
                  <option key={entry.name} value={entry.name}>
                    {entry.name} — {num(entry.cohortReplays ?? 0, 0)} replay{(entry.cohortReplays ?? 0) > 1 ? 's' : ''}
                  </option>
                ))}
              </select>
              <p className="field__hint">
                Uniquement les joueurs déjà analysés pour ce mode. Les autres noms du champ de saisie sont des suggestions
                de pseudos, pas des cohortes.
              </p>
            </div>
            <Button
              variant="primary"
              icon="check"
              loading={applying}
              onClick={() => applyPlayer(draftPlayer.trim())}
              disabled={!draftPlayer.trim()}
            >
              Définir comme référence
            </Button>
          </div>
        ) : null}

        {playersRes.error ? (
          <Banner tone="danger" title="Impossible de lister les pros connus">{playersRes.error}</Banner>
        ) : null}
        {!playersRes.loading && !measured.length ? (
          <p className="hint-text">
            Aucun joueur n'a de cohorte mesurée pour ce mode
            {playersRes.data?.updatedAt ? ` (cohorte globale mise à jour ${relative(playersRes.data.updatedAt)})` : ''}. Saisis
            un pseudo ballchasing exact ci-dessus puis lance une actualisation : sa cohorte apparaîtra ensuite ici.
          </p>
        ) : null}
      </Card>

      {res.error ? (
        <Banner tone="danger" title="Impossible de charger la référence pro" action={<Button size="sm" icon="refresh" onClick={res.reload}>Réessayer</Button>}>
          {res.error}
        </Banner>
      ) : null}

      {needsPlayer ? (
        <Card>
          <EmptyState
            icon="pro"
            title="Aucune référence active"
            description="Choisis la cohorte globale ou saisis le pseudo ballchasing exact d'un joueur : la référence s'applique aussitôt à tout l'historique."
          />
        </Card>
      ) : null}

      {cohort && cohort.playerAvailable === false ? (
        <Banner
          tone="danger"
          title={`Aucune donnée pour « ${cohort.player || effectivePlayer} »`}
          action={
            <Button size="sm" icon="refresh" disabled={!tokenSet || running} loading={busy} onClick={handleRefresh}>
              Actualiser ce joueur
            </Button>
          }
        >
          Aucun replay de ce joueur n’a encore été analysé pour ce mode : les repères de démarrage sont utilisés à la place.
          {tokenSet
            ? ' Lance une actualisation pour construire sa référence (ses replays seront récupérés via ballchasing).'
            : ' Un token ballchasing est nécessaire pour récupérer ses replays (Réglages → token).'}
        </Banner>
      ) : null}

      {cohort?.isDemo && cohort.playerAvailable !== false ? (
        <Banner
          tone="warn"
          title="Repères de démarrage, pas une vraie cohorte"
          action={tokenSet ? null : <a className="btn btn--ghost btn--sm" href="#/reglages">Ajouter un token</a>}
        >
          {cohort.note || 'Les valeurs affichées sont des ordres de grandeur embarqués. Ajoute un token ballchasing puis lance une actualisation pour obtenir les distributions réelles (p10 → p90).'}
        </Banner>
      ) : null}

      <div className="grid grid--2">
        <Card>
          <CardHead
            title="Cohorte utilisée"
            hint={playlistLabel(playlists, scope)}
            actions={
              <Badge tone={cohort?.isDemo ? 'warn' : 'ok'} dot>
                {SOURCE_LABELS[cohort?.source] || cohort?.source || 'inconnue'}
              </Badge>
            }
          />
          {res.loading && !cohort ? (
            <SkeletonBlock rows={4} />
          ) : cohort ? (
            <>
              <dl className="meta-list">
                <div><dt>Référence</dt><dd>{cohort.label || (cohort.mode === 'player' ? cohort.player : 'Pros')}</dd></div>
                <div><dt>Type</dt><dd>{cohort.mode === 'player' ? 'joueur unique' : 'cohorte globale'}</dd></div>
                <div><dt>Replays analysés</dt><dd>{num(cohort.replaysAnalyzed, 0)}</dd></div>
                <div><dt>{cohort.mode === 'player' ? 'Performances' : 'Joueurs pros'}</dt><dd>{num(cohort.mode === 'player' ? cohort.sampleSize : cohort.playersAnalyzed, 0)}</dd></div>
                <div><dt>Échantillons</dt><dd>{num(cohort.sampleSize, 0)}</dd></div>
                <div><dt>Métriques suivies</dt><dd>{num(rows.length, 0)} / {num(METRICS.length, 0)}</dd></div>
                <div><dt>Mise à jour</dt><dd>{cohort.updatedAt ? relative(cohort.updatedAt) : 'jamais'}</dd></div>
                <div><dt>État</dt><dd>{cohort.isDemo ? 'repères de démarrage' : 'mesurée'}</dd></div>
              </dl>
              {cohort.note ? <p className="hint-text">{cohort.note}</p> : null}
            </>
          ) : (
            <p className="muted">Aucune cohorte disponible.</p>
          )}
        </Card>

        <Card>
          <CardHead
            title="Actualiser depuis ballchasing"
            hint={effectiveMode === 'player' ? `Récupère les replays de ${effectivePlayer || 'ce joueur'} pour ce mode.` : 'Agrège les replays de tous les pros pour ce mode.'}
            actions={running ? <Badge tone="info" dot>en cours</Badge> : null}
          />
          {!tokenSet ? (
            <Banner tone="info" title="Token ballchasing requis">
              L’actualisation nécessite un token API (gratuit). Ajoute-le dans les <a href="#/reglages">réglages</a>, puis reviens ici.
            </Banner>
          ) : null}
          <div className="form-row form-row--end">
            <div className="field">
              <label className="field__label" htmlFor="pro-size">Replays par actualisation</label>
              <select id="pro-size" className="input" value={size} disabled={running} onChange={(event) => setSize(Number(event.target.value))}>
                {SIZES.map((value) => <option key={value} value={value}>{value} replays</option>)}
              </select>
            </div>
            <Button
              variant="primary"
              icon="refresh"
              loading={busy}
              disabled={!tokenSet || running || (effectiveMode === 'player' && !effectivePlayer)}
              onClick={handleRefresh}
            >
              {running ? 'Actualisation en cours…' : effectiveMode === 'player' ? 'Actualiser ce joueur' : 'Actualiser la cohorte'}
            </Button>
          </div>
          {refresh && (refresh.running || refresh.startedAt || refresh.error) ? (
            <div className="refresh">
              <div className="refresh__head">
                <span>{running ? 'Analyse des replays…' : refresh.error ? 'Dernière actualisation en échec' : 'Dernière actualisation terminée'}</span>
                <span className="muted">
                  {num(refresh.done || 0, 0)} / {num(refresh.total || 0, 0)}
                  {refresh.mode ? ` · ${refresh.mode === 'player' ? refresh.player || 'joueur' : 'cohorte globale'}` : ''}
                </span>
              </div>
              <Meter value={progressPercent} tone={refresh.error ? 'danger' : running ? 'brand' : 'good'} label="Progression de l’actualisation" />
              {refresh.error ? <p className="field__error">{refresh.error}</p> : null}
              {refresh.startedAt ? (
                <p className="hint-text">
                  Démarrée {relative(refresh.startedAt)}
                  {refresh.finishedAt ? ` · terminée ${relative(refresh.finishedAt)}` : ''}
                </p>
              ) : (
                <p className="hint-text">Aucune actualisation lancée depuis le démarrage du serveur.</p>
              )}
            </div>
          ) : null}
        </Card>
      </div>

      <Card>
        <CardHead
          title="Distributions par métrique"
          hint={
            cohort?.mode === 'player'
              ? `p10 → p90 des performances de ${cohort.player || effectivePlayer}. Le point orange est ta moyenne.`
              : 'p10 → p90 des performances pros. Le point orange est ta moyenne, le trait fort la médiane pro.'
          }
          actions={<Badge tone="neutral">{num(rows.length, 0)} métriques</Badge>}
        />
        {res.loading && !rows.length ? (
          <SkeletonBlock rows={6} />
        ) : !rows.length ? (
          <EmptyState icon="pro" title="Aucune distribution disponible" description="Lance une actualisation ballchasing ou vérifie que le serveur répond." />
        ) : (
          <div className="pro-groups">
            {groups.map(([group, list]) => (
              <section key={group} className="pro-group">
                <h3 className="cmp-group__title" style={{ '--cat-color': METRIC_GROUPS[group]?.color }}>
                  <span className="cmp-group__dot" aria-hidden="true" />
                  {METRIC_GROUPS[group]?.label || group}
                </h3>
                <div className="table-wrap">
                  <table className="data-table data-table--pro">
                    <thead>
                      <tr>
                        <th scope="col">Métrique</th>
                        <th scope="col" className="is-num">p10</th>
                        <th scope="col" className="is-num">p25</th>
                        <th scope="col" className="is-num is-median">p50</th>
                        <th scope="col" className="is-num">p75</th>
                        <th scope="col" className="is-num">p90</th>
                        <th scope="col">Distribution</th>
                        <th scope="col" className="is-num">n</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((metric) => {
                        const ref = metrics[metric.key];
                        const mine = myValues.get(metric.key);
                        return (
                          <tr key={metric.key}>
                            <th scope="row" className="cell-metric">
                              {metric.label}
                              {metric.higherIsBetter === null ? <span className="cell-metric__count">neutre</span> : null}
                            </th>
                            {['p10', 'p25', 'p50', 'p75', 'p90'].map((key) => (
                              <td key={key} className={`is-num${key === 'p50' ? ' is-median' : ''}`}>
                                {fmtMetric(ref?.[key], metric.unit, metric.decimals)}
                              </td>
                            ))}
                            <td className="cell-spread">
                              <SpreadBar reference={ref} value={mine} unit={metric.unit} decimals={metric.decimals} higherIsBetter={metric.higherIsBetter} />
                            </td>
                            <td className="is-num muted">{num(ref?.count, 0)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHead title="D’où viennent les valeurs ?" />
        <div className="note-grid">
          <div>
            <h3 className="note-grid__title"><Icon name="pro" size={15} /> Cohorte globale</h3>
            <p className="muted">Distributions calculées sur tous les replays pros récupérés pour ce mode : c’est la référence « coach global ».</p>
          </div>
          <div>
            <h3 className="note-grid__title"><Icon name="users" size={15} /> Joueur unique</h3>
            <p className="muted">Distributions calculées uniquement sur les replays d’un pro : les écarts deviennent son style de jeu, pas une moyenne du circuit.</p>
          </div>
          <div>
            <h3 className="note-grid__title"><Icon name="info" size={15} /> Repères de démarrage</h3>
            <p className="muted">Sans token, l’app utilise des ordres de grandeur embarqués : les scores restent utiles mais approximatifs.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
