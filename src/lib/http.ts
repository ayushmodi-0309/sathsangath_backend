import { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { MulterError } from "multer";

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}
export const wrap = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res).catch(next); };

/** Reads ?page, ?pageSize, ?sort, ?order and returns skip/take/sort/order plus the envelope builder. */
export function paging(req: Request, defaultSize = 20, opts?: { defaultSort?: string; defaultOrder?: "asc" | "desc"; allowedSorts?: string[] }) {
  const n = (v: unknown, d: number) => { const x = Math.floor(Number(v)); return Number.isFinite(x) && x >= 1 ? x : d; };
  const page = n(req.query.page, 1);
  const pageSize = Math.min(n(req.query.pageSize, defaultSize), 100);
  const { defaultSort = "createdAt", defaultOrder = "desc", allowedSorts } = opts ?? {};
  const sortRaw = typeof req.query.sort === "string" ? req.query.sort : "";
  const sort = allowedSorts ? (allowedSorts.includes(sortRaw) ? sortRaw : defaultSort) : (sortRaw || defaultSort);
  const order: "asc" | "desc" = req.query.order === "asc" ? "asc" : (req.query.order === "desc" ? "desc" : defaultOrder);
  return {
    page, pageSize, skip: (page - 1) * pageSize, take: pageSize, sort, order,
    envelope: <T>(total: number, items: T[]) => ({ total, page, pageSize, sort, order, items }),
  };
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const i of err.issues) fields[i.path.join(".") || "_"] = i.message;
    return res.status(422).json({ error: "Please correct the highlighted fields.", fields });
  }
  if (err instanceof MulterError) {
    const msg = err.code === "LIMIT_FILE_SIZE" ? "That file is too large. Photos can be up to 5 MB and documents up to 8 MB."
      : err.code === "LIMIT_UNEXPECTED_FILE" || err.code === "LIMIT_FILE_COUNT" ? "Too many files were attached." : "The upload could not be processed.";
    return res.status(413).json({ error: msg, fields: err.code === "LIMIT_FILE_SIZE" ? { photos: msg } : {} });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
  console.error(err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
}
