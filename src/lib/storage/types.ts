/** Provider-agnostic object storage. Implement this to add a new backend (e.g. GCS). */
export interface StorageProvider {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Time-limited GET link for a private object. */
  signedUrl(key: string, expiresInSec: number): Promise<string>;
  /**
   * Time-limited PUT link so a browser can upload straight to storage,
   * bypassing the 4.5 MB request-body cap on our serverless functions.
   *
   * `contentType` is recorded on the object but is NOT part of the signature
   * (S3 presigned PUTs sign the host only), and the size cannot be constrained
   * at all. Whatever lands here is therefore untrusted until `head` has been
   * used to check the stored object — see claimKey in routes/account.ts.
   */
  signedPut(key: string, contentType: string, expiresInSec: number): Promise<string>;
  /** Size and type of a stored object, or null when it is not there. */
  head(key: string): Promise<{ size: number; contentType?: string } | null>;
}
