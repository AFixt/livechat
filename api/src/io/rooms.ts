/**
 * Socket.IO room used to reach AFixt staff who have no tenant of their own
 * (`tenant_id` is null) and therefore watch every tenant. Visitor/chat events
 * are mirrored here in addition to the per-tenant `tenant:{id}` room, so
 * untenanted staff receive them while tenant-scoped staff stay isolated.
 */
export const GLOBAL_STAFF_ROOM = 'staff:global';
