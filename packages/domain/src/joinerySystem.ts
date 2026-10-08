/**
 * #1052 slice 2 / #1219 — the component construction block joins the
 * joinery-system ladder. Pure mirrors of the Go engine
 * (backend-go/internal/domain/engine/joinery_system.go), pinned to the SAME
 * contracts/joinerySystemResolution.contract.json: relationship explicit >
 * source component > factory family > kind default, and the declared
 * connection faces gate (physical capacity, fail-closed).
 */

/** The rung order, trimmed: blank rungs never govern. */
export function effectiveJoinerySystem(
  relationshipSystemId: string,
  componentSystemId: string,
  factorySystemId: string,
  kindDefault: string,
): string {
  const explicit = relationshipSystemId.trim();
  if (explicit) return explicit;
  const component = componentSystemId.trim();
  if (component) return component;
  const factory = factorySystemId.trim();
  if (factory) return factory;
  return kindDefault;
}

/**
 * The declared connection faces gate: an anchor face outside the component's
 * declared capacity violates it. An empty declaration is compatible with
 * everything (legacy components); an anchor without a face cannot violate a
 * capacity it does not name.
 */
export function connectionFaceViolatesCapacity(
  declaredFaces: readonly string[] | undefined,
  anchorFace: string,
): boolean {
  const face = anchorFace.trim();
  if (!face) return false;
  if (!declaredFaces || declaredFaces.length === 0) return false;
  return !declaredFaces.some((declared) => declared.trim() === face);
}
