// HTTP request router for the ambercast viewer.

import { RUN_ID_PATTERN } from '#core/layout/resolve.js';
import { VIEW_COPY } from '#core/viewer/copy.js';
import { isAllowedHost } from '#core/viewer/host-allowlist.js';
import type { ViewPlan } from '#runtime/view-command.js';
import { renderRunDetail, renderRunList, renderError } from './render.js';

const CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

type Reply = { status: number; body: string | Uint8Array; contentType: string; allow?: string };

function errorReply(status: number, title: string, message: string, allow?: string): Reply {
  return { status, body: renderError(title, message), contentType: 'text/html; charset=utf-8', ...(allow && { allow }) };
}

function notFound(runId?: string): Reply {
  const copy = VIEW_COPY.errorPages.notFound;
  const message = runId === undefined ? copy.noSuchPage : `${copy.noRunPrefix}${runId}${copy.noRunSuffix}`;
  return errorReply(404, copy.title, message);
}

/**
 * Creates the viewer's HTTP handler for list, detail, raw-report, and screenshot routes.
 *
 * @param plan - Read-only report operations and the normalized bind host.
 * @param boundPort - The port actually assigned by the listening server.
 * @returns A request listener that writes the route's status, headers, and body.
 * @remarks
 * Every request checks the Host allowlist before its method and pathname. The
 * actual bound port matters because a candidate can differ from the port that
 * listen ultimately binds; a candidate-based check could reject valid Hosts or
 * accept a Host for another port. GET and HEAD share status and headers, while
 * HEAD sends no body. Non-GET/HEAD methods receive 405 regardless of path.
 *
 * The router tests RUN_ID_PATTERN itself to choose the 404 body: an invalid
 * run ID is "No such page", while an absent valid run is "No run". The usecase
 * deliberately collapses both conditions into one `not-found` kind. Route
 * failures map disappearance to 404 and other read failures to a fixed 500
 * response so a failed request cannot terminate the server. All responses
 * disable caching and sniffing; non-PNG responses also receive the fixed CSP
 * and referrer policy, including raw report bytes.
 */
export function createRequestListener(
  plan: ViewPlan,
  boundPort: number,
): (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void {
  return (req, res) => {
    const handle = async (): Promise<Reply> => {
      if (!isAllowedHost(req.headers.host, { bindHost: plan.bindHost, port: boundPort })) {
        const copy = VIEW_COPY.errorPages.forbidden;
        return errorReply(403, copy.title, copy.message);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const copy = VIEW_COPY.errorPages.methodNotAllowed;
        return errorReply(405, copy.title, copy.message, 'GET, HEAD');
      }

      const pathname = new URL(`http://placeholder${req.url ?? '/'}`).pathname;
      if (pathname === '/') {
        return { status: 200, body: renderRunList(await plan.reader.list()), contentType: 'text/html; charset=utf-8' };
      }

      const detail = /^\/runs\/([^/]+)$/.exec(pathname);
      if (detail) {
        const id = detail[1]!;
        if (!RUN_ID_PATTERN.test(id)) return notFound();
        const result = await plan.reader.get(id);
        if (result.kind === 'not-found' || result.kind === 'no-report') return notFound(id);
        return { status: 200, body: renderRunDetail(result), contentType: 'text/html; charset=utf-8' };
      }

      const raw = /^\/runs\/([^/]+)\/report\.json$/.exec(pathname);
      if (raw) {
        const id = raw[1]!;
        if (!RUN_ID_PATTERN.test(id)) return notFound();
        const result = await plan.reader.get(id);
        if (result.kind === 'not-found' || result.kind === 'no-report') return notFound(id);
        const bytes = await plan.reader.bytes(id);
        if (bytes.kind === 'not-found') return notFound(id);
        return { status: 200, body: bytes.bytes, contentType: result.kind === 'readable' ? 'application/json' : 'text/plain; charset=utf-8' };
      }

      const screenshot = /^\/runs\/([^/]+)\/screenshots\/([^/]+)$/.exec(pathname);
      if (screenshot) {
        const id = screenshot[1]!;
        if (!RUN_ID_PATTERN.test(id)) return notFound();
        let ref: string;
        try { ref = decodeURIComponent(screenshot[2]!); }
        catch (error) { if (error instanceof URIError) return notFound(); throw error; }
        const result = await plan.reader.screenshot(id, ref);
        if (result.kind === 'not-found') return notFound(id);
        return { status: 200, body: result.bytes, contentType: 'image/png' };
      }
      return notFound();
    };

    void handle().catch((error: unknown) => {
      if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return notFound();
      const copy = VIEW_COPY.errorPages.serverError;
      return errorReply(500, copy.title, copy.message);
    }).then((reply) => {
      res.statusCode = reply.status;
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', reply.contentType);
      if (reply.contentType !== 'image/png') {
        res.setHeader('Content-Security-Policy', CSP);
        res.setHeader('Referrer-Policy', 'no-referrer');
      }
      if (reply.allow) res.setHeader('Allow', reply.allow);
      res.end(req.method === 'HEAD' ? undefined : reply.body);
    });
  };
}
