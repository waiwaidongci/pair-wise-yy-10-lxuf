/*
 * 批缝补灰与复阴准入台 —— 业务规则（纯逻辑，不碰 DOM 与存储）
 * 规则要点：
 *  1. 每件作品仅允许一张未结束补灰单；
 *  2. 补灰批次停用，或含水率 > 12%，不得占用阴干柜位；
 *  3. 修补后换人，隔 24 小时两次称重，两次失重比例均在 0.20%~0.60%，
 *     且批缝闭合，才准入金粉；否则继续占位；
 *  4. 胎体或纹样修正后，旧准入结果按新值重算；
 *  5. 重复申请直接返回首次结果；并发申请共用同一次判定。
 */
(function () {
  "use strict";

  const MOISTURE_LIMIT = 12;        // 含水率上限（%）
  const LOSS_MIN = 0.002;           // 失重比例下限 0.20%
  const LOSS_MAX = 0.006;           // 失重比例上限 0.60%
  const WEIGH_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const REQUIRED_WEIGHINGS = 2;
  const SLOTS = ["A1", "A2", "A3", "B1", "B2", "B3"];

  function uuid() {
    return crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  function pct(ratio) {
    if (ratio == null || !Number.isFinite(ratio)) return "—";
    return (ratio * 100).toFixed(3) + "%";
  }

  // 失重比例 = (前值 - 后值) / 前值
  function lossRatio(prev, next) {
    prev = Number(prev);
    next = Number(next);
    if (!(prev > 0) || !Number.isFinite(next)) return null;
    return (prev - next) / prev;
  }

  function inBand(ratio) {
    return ratio != null && ratio >= LOSS_MIN - 1e-12 && ratio <= LOSS_MAX + 1e-12;
  }

  // 批次层面的准入/占位问题：停用、含水率超标
  function batchProblems(batch) {
    const problems = [];
    if (!batch) {
      problems.push("补灰批次不存在");
      return problems;
    }
    if (!batch.active) problems.push(`批次「${batch.name}」已停用`);
    const moisture = Number(batch.moisture);
    if (!Number.isFinite(moisture)) problems.push(`批次「${batch.name}」含水率未登记`);
    else if (moisture > MOISTURE_LIMIT) problems.push(`批次「${batch.name}」含水率 ${moisture}% 超过 ${MOISTURE_LIMIT}%`);
    return problems;
  }

  function batchUsable(batch) {
    return batchProblems(batch).length === 0;
  }

  // 一次称重的展示/校验信息（以修补完成初重为第 0 次基准）
  function weighingStats(order) {
    const ws = order.weighings || [];
    const baseline = [{ weight: Number(order.repairWeight), at: order.repairedAt, person: order.repairer, label: "修补初重" }];
    ws.forEach((w, i) => baseline.push({ weight: Number(w.weight), at: w.at, person: w.person, label: "第" + (i + 1) + "次称重" }));
    const stats = [];
    for (let i = 1; i < baseline.length; i++) {
      const ratio = lossRatio(baseline[i - 1].weight, baseline[i].weight);
      stats.push({
        label: baseline[i].label,
        at: baseline[i].at,
        person: baseline[i].person,
        weight: baseline[i].weight,
        ratio: ratio,
        ratioText: pct(ratio),
        inBand: inBand(ratio)
      });
    }
    return stats;
  }

  // 完整准入判定：返回 { verdict: "pass" | "fail", problems: [...] }
  function evaluate(order, work, batch) {
    const problems = [];

    if (!order.slotId) problems.push("尚未占用阴干柜位");
    problems.push.apply(problems, batchProblems(batch));

    if (!(Number(order.repairWeight) > 0)) problems.push("修补初重未登记");
    if (!order.repairedAt) problems.push("修补完成时间未登记");

    const ws = order.weighings || [];
    if (ws.length < REQUIRED_WEIGHINGS) {
      problems.push(`称重未完成（${ws.length}/${REQUIRED_WEIGHINGS}），需换人隔 24 小时两次称重`);
    } else {
      const [w1, w2] = ws;
      // 换人：两次称重都不能由修补人本人完成
      if (order.repairer && (w1.person === order.repairer || w2.person === order.repairer)) {
        problems.push("称重人未与修补人换人");
      }
      if (order.repairedAt && new Date(w1.at).getTime() < new Date(order.repairedAt).getTime()) {
        problems.push("首次称重时间早于修补完成时间");
      }
      if (new Date(w2.at).getTime() - new Date(w1.at).getTime() < WEIGH_INTERVAL_MS) {
        problems.push("两次称重间隔不足 24 小时");
      }
      const r1 = lossRatio(order.repairWeight, w1.weight);
      const r2 = lossRatio(w1.weight, w2.weight);
      if (!inBand(r1)) problems.push(`首次失重比例 ${pct(r1)} 不在 0.20%~0.60%`);
      if (!inBand(r2)) problems.push(`二次失重比例 ${pct(r2)} 不在 0.20%~0.60%`);
    }

    if (!order.seamClosed) problems.push("批缝尚未闭合");

    return { verdict: problems.length ? "fail" : "pass", problems: problems };
  }

  // 判定输入指纹：胎体、纹样、批次状态、柜位、称重、批缝任一变化都会产生新指纹
  function signature(order, work, batch) {
    return JSON.stringify({
      v: 2,
      work: { base: work.base, theme: work.theme },
      batch: batch ? { id: batch.id, active: !!batch.active, moisture: Number(batch.moisture) } : null,
      slot: order.slotId || null,
      seam: !!order.seamClosed,
      repairer: order.repairer,
      repairedAt: order.repairedAt,
      repairWeight: Number(order.repairWeight),
      weighings: (order.weighings || []).map(w => [w.at, w.person, Number(w.weight)])
    });
  }

  // 进行中的并发判定：同一补灰单共用同一个 Promise（并发沿用首次结果）
  const inflight = new Map();

  function evaluateAdmission(order, work, batch) {
    const sig = signature(order, work, batch);
    // 输入未变：重复申请直接沿用首次判定
    if (order.eval && order.eval.sig === sig) return Promise.resolve(order.eval);
    if (inflight.has(order.id)) return inflight.get(order.id);

    const pending = new Promise(resolve => {
      // 留出并发窗口，连点“准入判定”只会产生一次判定
      setTimeout(() => {
        inflight.delete(order.id);
        const result = evaluate(order, work, batch);
        resolve(Object.assign({}, result, { sig: sig, at: new Date().toISOString() }));
      }, 450);
    });
    inflight.set(order.id, pending);
    return pending;
  }

  window.Rules = {
    MOISTURE_LIMIT: MOISTURE_LIMIT,
    LOSS_MIN: LOSS_MIN,
    LOSS_MAX: LOSS_MAX,
    WEIGH_INTERVAL_MS: WEIGH_INTERVAL_MS,
    REQUIRED_WEIGHINGS: REQUIRED_WEIGHINGS,
    SLOTS: SLOTS,
    uuid: uuid,
    pct: pct,
    lossRatio: lossRatio,
    inBand: inBand,
    batchProblems: batchProblems,
    batchUsable: batchUsable,
    weighingStats: weighingStats,
    signature: signature,
    evaluate: evaluate,
    evaluateAdmission: evaluateAdmission
  };
})();
