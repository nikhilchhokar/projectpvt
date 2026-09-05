/**
 * Raster asset version.
 *
 * Stamped into every raster URL so that a change to the scene generator or the
 * tone curve produces new URLs rather than relying on a browser to revalidate.
 * Cache revalidation is the theoretically correct mechanism and it is also the
 * one that fails quietly: a viewer holding a stale image shows imagery from an
 * older renderer while the analysis numbers beside it have moved on, and
 * nothing on screen says so. Versioning the URL makes that state unreachable.
 *
 * Fixed for the life of the process, so it changes on deploy and on restart.
 */
export const RASTER_VERSION = String(Date.now());
