/** Serializable observations and registered artifact checks, shared with the client. */
/** Frozen requirement; contains is literal text, never a natural-language condition. */
export interface ArtifactCheck { readonly id: string; readonly path: string; readonly contains?: string | undefined }
/** Permission-bound read observation correlated to the exact executing child. */
export interface ReadEvidence { readonly path: string; readonly isError: boolean; readonly text: string }
/** Check results cover only registered requirements, never overall task correctness. */
export interface VerificationReport {
  readonly status: 'passed' | 'failed' | 'unverified'
  readonly checks: readonly { readonly id: string; readonly status: 'passed' | 'failed' | 'unverified'; readonly reason: string }[]
}
