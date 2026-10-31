import { useMemo, useState } from 'react';
import { useApiResource } from '../hooks/useApiResource.js';
import { api } from '../api.js';
import { Badge, Banner, Button, Card, CardHead, EmptyState, PageHead, Skeleton, SkeletonBlock } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';
import { ScoreGauge } from '../components/charts.jsx';
import { MetricCompareRow, PlayerStatsTable, RecommendationCard, StrengthList } from '../components/coach.jsx';
import { AiCoachCard } from '../components/ai.jsx';
import { useToast } from '../components/Toast.jsx';
import { clock, dateTime, durationLabel, num, relative, EMPTY } from '../format.js';
import { METRIC_GROUPS, playlistLabel } from '../metrics.js';
import { useAppData } from '../hooks/useAppData.jsx';

const RESULT = {
  win: { label: 'Victoire', tone: 'ok' },
  loss: { label: 'Défaite', tone: 'danger' },
  unknown: { label: 'Résultat inconnu', tone: 'neutral' },
};

export default function MatchDetailView({ id, navigate }) {
  const { playlists, status } = useAppData();
  const toast = useToast();
  const res = useApiResource((signal) => api.match(id, signal), [id]);
  const [aiOverride, setAiOverride] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const match = res.data?.match || null;
  const coaching = match?.coaching || null;
  const comparison = match?.comparison || null;

  const aiEnabled = Boolean(status?.ai?.enabled);
  const aiReason = status?.ai?.reason || null;
  const ai = aiOverride || match?.ai || null;
  const referenceLabel =
    comparison?.referenceLabel ||
    comparison?.cohort?.label ||
    status?.ballchasing?.reference?.label ||
    'Pros';

  async function handleGenerateAi() {
    setAiLoading(true);
    setAiError(null);
    try {
      const result = await api.matchAi(id);
      setAiOverride(result?.ai || null);
      toast.push({
        kind: 'success',
        title: 'Débriefing généré',
        message: result?.ai?.model ? `Rédigé par ${result.ai.provider} · ${result.ai.model}.` : undefined,
      });
    } catch (error) {
      setAiError(error.message);
    } finally {
      setAiLoading(false);
    }
  }

  const groups = useMemo(() => {
    const map = new Map();
    for (const row of comparison?.metrics || []) {
      if (!map.has(row.group)) map.set(row.group, []);
      map.get(row.group).push(row);
    }
    return [...map.entries()];
  }, [comparison]);

  if (res.loading && !match) {
    return (
      <div className="page">
        <PageHead eyebrow="Analyse" title="Chargement du match…" subtitle="Lecture du fichier de match et de la comparaison pro." />
        <div className="grid grid--2">
          <Card><SkeletonBlock rows={5} /></Card>
          <Card><SkeletonBlock rows={5} /></Card>
        </div>
        <Card><Skeleton height={220} radius={12} /></Card>
      </div>
    );
  }

  if (res.error || !match) {
    return (
      <div className="page">
        <PageHead eyebrow="Analyse" title="Match indisponible" />
        <Banner tone="danger" title="Impossible d’ouvrir ce match" action={<Button size="sm" icon="history" onClick={() => navigate('/historique')}>Retour à l’historique</Button>}>
          {res.error || 'Ce match n’existe plus (supprimé ou identifiant inconnu).'}
        </Banner>
      </div>
    );
  }

  const result = RESULT[match.result] || RESULT.unknown;
  const mine = match.localTeam ?? 0;
  const score = comparison?.score ?? coaching?.score ?? null;

  return (
    <div className="page">
      <div className="back-row">
        <a className="btn btn--ghost btn--sm" href="#/historique">
          <Icon name="chevronLeft" size={15} />
          <span>Historique</span>
        </a>
        <span className="back-row__meta">{relative(match.date)}</span>
      </div>

      <PageHead
        eyebrow={match.playlistLabel || playlistLabel(playlists, match.playlist)}
        title={`Match du ${dateTime(match.date)}`}
        subtitle={`${match.arena || 'Arène inconnue'} · ${durationLabel(match.durationSeconds)} · ${match.mode === 'demo' ? 'match simulé (démo)' : 'API Stats'}`}
        actions={
          <div className="head-status">
            <Badge tone={result.tone} dot>{result.label}</Badge>
            <Badge tone="ghost">
              {num(match.teamScores?.[0] ?? 0, 0)} – {num(match.teamScores?.[1] ?? 0, 0)}
              <span className="badge__sub">ton équipe : {mine === 0 ? 'bleue' : 'orange'}</span>
            </Badge>
            <Badge tone="neutral">durée {clock(match.durationSeconds)}</Badge>
            <Badge tone="accent" title="Base de comparaison utilisée pour ce match">Réf. : {referenceLabel}</Badge>
          </div>
        }
      />

      {match.warnings?.length ? (
        <Banner tone="warn" title="Avertissements d’analyse">
          <ul className="bullets">
            {match.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Banner>
      ) : null}

      <div className="grid grid--hero">
        <Card>
          <CardHead title="Score coach" hint={comparison ? `${comparison.playlistLabel} · cohorte ${comparison.cohort.isDemo ? 'repères de démarrage' : `${num(comparison.cohort.replaysAnalyzed, 0)} replays pro`}` : 'Comparaison indisponible'} />
          <div className="hero-score">
            <ScoreGauge score={score} grade={coaching?.grade || comparison?.grade} level={coaching?.level || comparison?.level} />
            <div className="hero-score__body">
              <p className="hero-score__headline">{coaching?.headline || 'Analyse en cours…'}</p>
              {coaching?.summary ? <p className="hero-score__summary">{coaching.summary}</p> : null}
              <div className="hero-score__badges">
                {coaching?.playerName ? <Badge tone="accent">{coaching.playerName}</Badge> : null}
                <Badge tone={comparison?.cohort?.isDemo ? 'warn' : 'ok'}>Référence : {referenceLabel}</Badge>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <CardHead title="Forces & faiblesses" hint="Comparé à la cohorte pro de ce mode" />
          <div className="split">
            <div>
              <h3 className="split__title">
                <Icon name="check" size={14} /> Points forts
              </h3>
              <StrengthList items={coaching?.strengths || []} emptyLabel="Aucun point fort au-dessus du seuil pro sur ce match." />
            </div>
            <div>
              <h3 className="split__title">
                <Icon name="alert" size={14} /> À travailler
              </h3>
              <StrengthList items={coaching?.weaknesses || []} emptyLabel="Aucune faiblesse marquée sur ce match." />
            </div>
          </div>
          {coaching?.generatedAt ? <p className="hint-text">Analyse générée {relative(coaching.generatedAt)}.</p> : null}
        </Card>
      </div>

      <Card>
        <CardHead
          title="Comparaison métrique par métrique"
          hint="Le repère de la barre est la médiane pro (p50). La cible est le palier p25."
          actions={<Badge tone="neutral">{num(comparison?.metrics?.length, 0)} métriques</Badge>}
        />
        {!comparison?.metrics?.length ? (
          <EmptyState
            icon="coach"
            title="Aucune comparaison disponible"
            description="Ce match n’a pas pu être comparé (joueur local non identifié ou statistiques incomplètes)."
          />
        ) : (
          <div className="cmp-groups">
            {groups.map(([group, rows]) => (
              <section key={group} className="cmp-group">
                <h3 className="cmp-group__title" style={{ '--cat-color': METRIC_GROUPS[group]?.color }}>
                  <span className="cmp-group__dot" aria-hidden="true" />
                  {METRIC_GROUPS[group]?.label || group}
                </h3>
                <div className="cmp-grid">
                  {rows.map((row) => (
                    <MetricCompareRow key={row.key} row={row} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHead title="Joueurs du match" hint="Ta ligne est surlignée. Le score coach n’est calculé que pour toi." />
        <PlayerStatsTable players={match.players || []} />
      </Card>

      <Card>
        <CardHead
          title="Recommandations du coach"
          hint="Classées par impact estimé : commence par la première."
          actions={<Badge tone={coaching?.recommendations?.length ? 'warn' : 'ok'}>{num(coaching?.recommendations?.length, 0)} action(s)</Badge>}
        />
        {coaching?.recommendations?.length ? (
          <div className="reco-list">
            {coaching.recommendations.map((recommendation, index) => (
              <RecommendationCard key={recommendation.id} recommendation={recommendation} index={index} expanded />
            ))}
          </div>
        ) : (
          <EmptyState
            icon="check"
            title="Aucune faiblesse prioritaire"
            description={coaching?.headline || 'Ton profil est équilibré face aux pros sur ce match : cherche la régularité.'}
            action={<Button size="sm" icon="coach" onClick={() => navigate('/coach')}>Voir la vue d’ensemble</Button>}
          />
        )}
      </Card>

      <AiCoachCard
        ai={ai}
        loading={aiLoading}
        error={aiError}
        enabled={aiEnabled}
        reason={aiReason}
        onGenerate={handleGenerateAi}
        idleDescription={`Le coach IA reformule le diagnostic de ce match (référence : ${referenceLabel}) en un débriefing de coach.`}
      />

      <Card>
        <CardHead title="Contexte technique" />
        <dl className="meta-list">
          <div>
            <dt>Source</dt>
            <dd>{match.source || EMPTY}</dd>
          </div>
          <div>
            <dt>Identifiant</dt>
            <dd className="mono">{match.id}</dd>
          </div>
          <div>
            <dt>Buts enregistrés</dt>
            <dd>{num(match.goals?.length, 0)}</dd>
          </div>
          <div>
            <dt>Événements</dt>
            <dd>{num(match.events?.length, 0)}</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
