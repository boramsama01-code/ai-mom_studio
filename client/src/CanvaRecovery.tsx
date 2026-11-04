import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from './api';
import { ErrorBox } from './ui';
import type { CanvaJobDto } from '../../shared/canvaEditorial';
import { canvaDesignIdFromInput, canvaReconciliations, type CanvaReconcileRequest } from '../../shared/canvaReconciliation';
import { clearCanvaRequest, parseCanvaJob, readCanvaReconcileRequest } from './canvaEditorialContract';

export function CanvaRecovery({ channelId, itemId, version, job, disabled, connected, busy, onRecovered }: { channelId: number; itemId: number; version: number; job: CanvaJobDto; disabled: boolean; connected: boolean; busy: boolean; onRecovered: (job: CanvaJobDto) => void }) {
  const requestKey = `canva-reconcile:${channelId}:${itemId}:${job.id}`;
  const [pending, setPending] = useState<CanvaReconcileRequest | null>(() => readCanvaReconcileRequest(requestKey));
  const [designInput, setDesignInput] = useState(job.designId ?? pending?.designId ?? ''), [confirmed, setConfirmed] = useState(false);
  const submitting = useRef(false);
  const designId = canvaDesignIdFromInput(designInput);
  useEffect(() => { setConfirmed(false); }, [version, job.recoveryToken]);
  useEffect(() => {
    if (!pending) return;
    if (canvaReconciliations(job.result).some(record => record.recoveryToken === pending.expectedRecoveryToken && record.designId === pending.designId && record.sourceVersion === pending.version)) {
      clearCanvaRequest(requestKey); setPending(null);
    }
  }, [job.result, pending, requestKey]);
  const recover = useMutation({ mutationFn: async () => {
    if (submitting.current) throw new Error('이미 연결 결과를 확인 중입니다.');
    if (disabled || busy || !connected) throw new Error('현재 원고를 저장하고 Canva 연결을 확인해 주세요.');
    const body: CanvaReconcileRequest = pending ?? (() => {
      if (!confirmed || !designId || !job.recoveryToken) throw new Error('현재 콘텐츠의 디자인인지 확인하고 Canva 링크를 입력해 주세요.');
      return { version, designId, confirmed: true, expectedRecoveryToken: job.recoveryToken };
    })();
    submitting.current = true; setPending(body);
    try { sessionStorage.setItem(requestKey, JSON.stringify(body)); } catch { /* Durable job recovery remains authoritative. */ }
    try {
      const recovered = parseCanvaJob(await api(`/channels/${channelId}/items/${itemId}/canva/jobs/${job.id}/reconcile`, { method: 'POST', body }));
      const accepted = canvaReconciliations(recovered.result).some(record => record.recoveryToken === body.expectedRecoveryToken && record.designId === body.designId && record.sourceVersion === body.version);
      if (recovered.id !== job.id || recovered.purpose !== 'import' || !accepted) throw new ApiError(502, '연결 요청에 맞는 Canva 결과를 확인하지 못했습니다. 같은 연결 요청의 결과를 다시 확인해 주세요.');
      return recovered;
    } finally { submitting.current = false; }
  }, onSuccess: recovered => { clearCanvaRequest(requestKey); setPending(null); onRecovered(recovered); }, onError: error => {
    if (error instanceof ApiError && [400, 401, 403, 404, 409, 422, 429].includes(error.status)) { clearCanvaRequest(requestKey); setPending(null); }
  } });
  const blocked = disabled || busy || recover.isPending || !connected;
  return <details className="content-options canva-recovery" open={!!pending}>
    <summary>{job.designId ? '기존 디자인의 8장 가져와 복구하기' : 'Canva에서 찾은 디자인으로 복구하기'}</summary>
    <div className="stack">
      <p>Canva에서 이 콘텐츠용 8장 디자인을 확인한 뒤 연결해 주세요. 같은 디자인을 새로 생성하지 않고 8장 이미지로 내보냅니다.</p>
      {!job.designId && <p className="small muted">요청 당시 제목 끝의 표식은 <strong>{job.requestId.slice(0, 8)}</strong>입니다. 제목을 바꿨어도 연결할 수 있지만 모든 문구를 직접 대조해야 합니다. 이미지 업로드에서 멈췄다면 Canva에서 직접 완성한 8장 디자인도 연결할 수 있습니다.</p>}
      {job.sourceVersion !== version && <p className="notice warn">처음 요청한 뒤 원고가 바뀌었습니다. 현재 저장본과 8장 전체를 대조한 뒤에만 적용할 수 있습니다.</p>}
      <label className="field">이 콘텐츠의 Canva 디자인 링크 또는 ID<input aria-label="복구할 Canva 디자인 링크 또는 ID" value={designInput} maxLength={8192} readOnly={!!job.designId || !!pending} disabled={blocked} placeholder="https://www.canva.com/design/D…/edit" onChange={event => { setDesignInput(event.target.value); setConfirmed(false); }} /></label>
      {!!designInput.trim() && !designId && <p className="notice warn small">Canva 디자인 링크나 D로 시작하는 디자인 ID를 입력해 주세요.</p>}
      {!pending && <label className="check"><input type="checkbox" checked={confirmed} disabled={blocked || !designId || !job.recoveryToken} onChange={event => setConfirmed(event.target.checked)} /><span>지금 열어둔 이 콘텐츠의 8장 디자인입니다. 가져온 뒤 현재 원고와 모든 문구를 다시 대조하겠습니다.</span></label>}
      {pending && <p className="notice warn">연결 요청의 응답을 아직 확인하지 못했습니다. 같은 요청으로 결과만 다시 확인합니다.</p>}
      <button className="btn" disabled={blocked || !pending && (!confirmed || !designId || !job.recoveryToken)} onClick={() => recover.mutate()}>{recover.isPending ? '디자인 확인 중…' : pending ? '디자인 연결 결과 확인' : '이 디자인의 8장 가져와 대조하기'}</button>
      <p className="small muted">소유 계정·팀과 1080×1350 크기 8장을 검사합니다. 가져오기 완료 후 이미지 8장 확인, 문구 대조, 새 버전 저장, 검토·승인을 차례로 진행합니다.</p>
      {recover.error && <ErrorBox error={recover.error} />}
    </div>
  </details>;
}
