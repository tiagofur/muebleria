/**
 * #729 — Demo Vertical Slice experience switches.
 *
 * Single, explicit visibility control for surfaces that stay implemented and
 * tested but must not appear in the demo's normal flow.
 *
 * `proyectarVisible`: SketchUp is the only design surface offered to demo
 * users (Diseños → "Abrir en SketchUp" pairing, #499). Proyectar (spatial
 * studio) keeps compiling, keeps its component tests green and stays
 * mountable directly; only its entry points — the chrome button, the
 * post-add place cue, the presentation actions and copy that names it — are
 * hidden while this is `false`. Do not scatter extra conditionals: new
 * Proyectar entry points must gate on this same switch. Re-enabling it for
 * everyone is the one-flag change below.
 *
 * The preserved direct path (Proyectar WebGL gate #444 and the studio
 * smoke/perf/usability specs) opts in per session with the
 * `granete_proyectar_visible` sessionStorage key — the same pattern as the
 * `granete_session` guest key. Nothing in the normal product flow writes
 * that key, so demo builds keep every Proyectar entry hidden.
 */
export const demoExperience = {
  proyectarVisible:
    typeof sessionStorage !== 'undefined' &&
    sessionStorage.getItem('granete_proyectar_visible') === '1',
} as const;
