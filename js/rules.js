/*
 * 批缝补灰与复阴准入台 —— 业务规则层
 * 纯逻辑：不接触 localStorage，不接触 DOM，页面与存储共用同一份判定口径。
 */
(function (global) {
  "use strict";

  var DAY_MS = 24 * 60 * 60 * 1000;

  var RULES = {
    MOISTURE_LIMIT: 12,      // 补灰批次含水率上限（%），含 12%
    LOSS_MIN: 0.002,         // 单次失重比例下限 0.2%
    LOSS_MAX: 0.006,         // 单次失重比例上限 0.6%
    WEIGH_GAP_MS: DAY_MS,    // 初称→第一次称重、第一次→第二次称重均须满 24 小时
    MAX_WEIGHINGS: 2         // 两次换人称重
  };

  function isOpen(order) {
    return !!order && (order.status === "open" || order.status === "drying");
  }

  function findOpenOrder(orders, workId) {
    return (orders || []).find(function (o) {
      return o.workId === workId && isOpen(o);
    });
  }

  /* 批次是否可用于阴干：启用中且含水率不超过 12% */
  function batchReady(batch) {
    if (!batch) return { ok: false, reason: "补灰批次不存在" };
    if (batch.active === false) {
      return { ok: false, reason: "批次 " + batch.code + " 已停用，不得占阴干位" };
    }
    var m = Number(batch.moisture);
    if (!(m <= RULES.MOISTURE_LIMIT)) {
      return {
        ok: false,
        reason: "批次 " + batch.code + " 含水率 " + m + "% 超过 12%，不得占阴干位"
      };
    }
    return { ok: true };
  }

  /* 修补后初称记录校验 */
  function validateRepair(input) {
    var reasons = [];
    var repairer = String((input && input.repairer) || "").trim();
    var repairedAt = Date.parse(input && input.repairedAt);
    var baseWeight = Number(input && input.baseWeight);
    if (!repairer) reasons.push("未填写修补人");
    if (isNaN(repairedAt)) reasons.push("修补完成时间无效");
    if (!(baseWeight > 0)) reasons.push("初称重量需为正数（克）");
    return {
      ok: reasons.length === 0,
      reasons: reasons,
      repairer: repairer,
      repairedAt: isNaN(repairedAt) ? null : repairedAt,
      baseWeight: baseWeight
    };
  }

  /* 单次换人称重校验：必须换人，且距上一节点（初称/上一次称重）满 24 小时 */
  function validateWeighing(order, input) {
    var reasons = [];
    if (!order || !(order.baseWeight > 0) || !order.repairer) {
      reasons.push("尚未登记修补人、修补时间与初称重量");
    }
    var at = Date.parse(input && input.at);
    var person = String((input && input.person) || "").trim();
    var weight = Number(input && input.weight);
    if (order && order.weighings.length >= RULES.MAX_WEIGHINGS) {
      reasons.push("两次换人称重已完成");
    }
    if (isNaN(at)) reasons.push("称重时间无效");
    if (!person) reasons.push("未填写称重人");
    if (person && order && order.repairer && person === order.repairer) {
      reasons.push("称重人必须与修补人不同（换人称重）");
    }
    if (!(weight > 0)) reasons.push("称重重量需为正数（克）");
    if (!isNaN(at) && order && order.baseWeight > 0) {
      var prevAt = order.weighings.length
        ? order.weighings[order.weighings.length - 1].at
        : order.repairedAt;
      var earliest = prevAt + RULES.WEIGH_GAP_MS;
      if (at < earliest) {
        reasons.push("距上一节点须满 24 小时，最早可称时间：" + formatDateTime(earliest));
      }
    }
    return {
      ok: reasons.length === 0,
      reasons: reasons,
      entry: { at: isNaN(at) ? null : at, person: person, weight: weight }
    };
  }

  function lossRatio(prevWeight, nextWeight) {
    if (!(Number(prevWeight) > 0)) return NaN;
    return (Number(prevWeight) - Number(nextWeight)) / Number(prevWeight);
  }

  function inLossBand(ratio) {
    return ratio >= RULES.LOSS_MIN && ratio <= RULES.LOSS_MAX;
  }

  function formatPercent(ratio) {
    if (isNaN(ratio)) return "—";
    return (ratio * 100).toFixed(3) + "%";
  }

  function formatDateTime(ms) {
    return new Date(ms).toLocaleString();
  }

  /* 判定输入指纹：胎体/纹样、批次状态、初称、两次称重、批缝、占位任一变化都会换指纹 */
  function fingerprint(order, work, batch) {
    var payload = JSON.stringify({
      w: work ? [work.base, work.theme] : null,
      b: batch ? [batch.id, batch.active, batch.moisture] : null,
      r: [order.repairer, order.repairedAt, order.baseWeight],
      s: [order.seamClosed, order.seamChecker],
      m: order.weighings.map(function (e) { return [e.at, e.person, e.weight]; }),
      st: order.status,
      slot: order.slotId
    });
    return hash32(payload) + ":" + payload.length;
  }

  function hash32(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(16);
  }

  /*
   * 准入判定（纯函数）：
   * 通过 = 已占阴干位 + 批次仍合格 + 初称齐备 + 两次换人称重间隔满 24h
   *         + 两段失重比例均在 0.2%–0.6% + 批缝闭合。
   * 任一不满足即为未通过；未通过时由存储层维持占位（继续占位）。
   */
  function evaluate(order, work, batch) {
    var reasons = [];
    var ratios = [];
    if (!order) {
      return { passed: false, reasons: ["补灰单不存在"], ratios: [], fingerprint: null };
    }
    if (order.status !== "drying") {
      reasons.push("补灰单尚未占阴干位");
    }
    var br = batchReady(batch);
    if (!br.ok) reasons.push(br.reason);

    if (!order.repairer || !(order.baseWeight > 0) || !order.repairedAt) {
      reasons.push("缺少修补后初称记录（修补人/时间/重量）");
    }

    if (order.weighings.length < RULES.MAX_WEIGHINGS) {
      reasons.push("尚需补做 " + (RULES.MAX_WEIGHINGS - order.weighings.length) + " 次换人称重");
    }

    var prevAt = order.repairedAt;
    var prevWeight = order.baseWeight;
    order.weighings.forEach(function (e, i) {
      var label = "第" + (i + 1) + "次称重";
      if (!(e.at >= prevAt + RULES.WEIGH_GAP_MS)) {
        reasons.push(label + "距上一节点不足 24 小时");
      }
      if (e.person && order.repairer && e.person === order.repairer) {
        reasons.push(label + "未换人（称重人与修补人相同）");
      }
      var ratio = lossRatio(prevWeight, e.weight);
      ratios.push(ratio);
      if (!inLossBand(ratio)) {
        reasons.push(label + "失重 " + formatPercent(ratio) + " 不在 0.200%–0.600% 区间");
      }
      prevAt = e.at;
      prevWeight = e.weight;
    });

    if (!order.seamClosed) reasons.push("批缝尚未确认闭合");

    var passed = reasons.length === 0 &&
      order.status === "drying" &&
      order.weighings.length === RULES.MAX_WEIGHINGS;

    return {
      passed: passed,
      reasons: reasons,
      ratios: ratios,
      fingerprint: fingerprint(order, work, batch)
    };
  }

  global.QXRules = {
    RULES: RULES,
    isOpen: isOpen,
    findOpenOrder: findOpenOrder,
    batchReady: batchReady,
    validateRepair: validateRepair,
    validateWeighing: validateWeighing,
    lossRatio: lossRatio,
    inLossBand: inLossBand,
    formatPercent: formatPercent,
    formatDateTime: formatDateTime,
    fingerprint: fingerprint,
    evaluate: evaluate
  };
})(window);
