export function mandateCacheScope(session: { user: { id: string }; session: { id: string; activeOrganizationId?: string | null } }) {
  return JSON.stringify([session.user.id, session.session.activeOrganizationId, session.session.id]);
}
