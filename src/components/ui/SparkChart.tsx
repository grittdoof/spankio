import {
  SPARK_FRAME,
  SPARK_VIEWBOX,
  TICK_BASELINE,
  type Sparkline,
} from '@/lib/design/sparkline';

/**
 * La courbe, dessinée une seule fois pour toute l'application.
 *
 * Elle était recopiée dans le rythme des réponses et dans les arrivées ; la
 * synthèse imprimable en aurait fait une troisième copie, et c'est le moment
 * où deux d'entre elles commencent à diverger — exactement ce qui est arrivé
 * à la composition d'un nom avant d'être ramenée à une fonction.
 *
 * **Un graphique est un renfort, jamais un porteur d'information.** Le SVG est
 * donc `aria-hidden`, et l'appelant écrit les mêmes valeurs à côté, en toutes
 * lettres. Le compte posé au-dessus d'un point l'est aussi : sinon le lecteur
 * d'écran énoncerait deux fois le même nombre, de part et d'autre de la valeur
 * qu'il qualifie.
 */
export function SparkChart({ chart }: { chart: Sparkline }) {
  return (
    <svg aria-hidden="true" className="sp-spark" viewBox={SPARK_VIEWBOX}>
      {/* Les trois règles viennent du CADRE, pas de valeurs écrites ici : le
          document Word les redessine à l'identique depuis la même source. */}
      {SPARK_FRAME.rules.map((y) => (
        <line
          className="sp-spark__rule"
          key={y}
          x1="0"
          x2={SPARK_FRAME.plotWidth}
          y1={y}
          y2={y}
        />
      ))}
      {chart.line ? (
        <>
          <path className="sp-spark__area" d={chart.area} />
          <path className="sp-spark__line" d={chart.line} />
        </>
      ) : null}
      {chart.points.map((point) => (
        <g key={point.label}>
          <circle className="sp-spark__dot" cx={point.x} cy={point.y} r="3.4" />
          <text
            className="sp-spark__value"
            textAnchor="middle"
            x={point.x}
            y={Math.max(9, point.y - 8)}
          >
            {point.value === 0 ? '' : point.value}
          </text>
          {/* Penchée, et ancrée par sa FIN : elle se lit de bas en haut vers la
              droite et descend à GAUCHE du point qu'elle nomme — donc jamais
              sur sa voisine. `tick` vaut `null` dans le seul cas où même
              l'inclinaison ne suffit plus à les séparer. */}
          {point.tick ? (
            <text
              className="sp-spark__tick"
              textAnchor="end"
              transform={`rotate(-${chart.tickAngle} ${point.x} ${TICK_BASELINE})`}
              x={point.x}
              y={TICK_BASELINE}
            >
              {point.tick}
            </text>
          ) : null}
        </g>
      ))}
    </svg>
  );
}
