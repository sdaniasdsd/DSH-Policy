interface OperationProgressProps {
  busy: boolean
  message: string | null
  error: string | null
}

export function OperationProgress({ busy, message, error }: OperationProgressProps) {
  if (!busy && !message && !error) return null
  return (
    <div className={`operation-note${error ? ' operation-note--error' : ''}`} role={error ? 'alert' : 'status'}>
      {busy && <span className="spinner" aria-hidden="true" />}
      <span>{error ?? message}</span>
    </div>
  )
}
