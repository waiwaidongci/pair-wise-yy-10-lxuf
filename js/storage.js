/*
 * 批缝补灰与复阴准入台 —— 存储层
 * 唯一数据入口：所有状态变更都经过本文件，并写 localStorage。
 * 页面只读 store.state，不直接改数据；判定缓存与并发合并也在这里。
 */
(function (global) {
  "use strict";

  var R = global.QXRules;
  var KEY = "qxRepairConsole.v1";
  var LEGACY_KEY = "zfl42Works";
  var DAY = 24 * 60 * 60 * 1000;

  function uid(prefix) {
    return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function nowText() {
    return new Date().toLocaleString();
  }

  function history(text, type, refs) {
    return { id: uid("ev"), at: Date.now(), text: text, type: type || "info", refs: refs || {} };
  }

  /* ---------- 种子 / 旧数据迁移 ---------- */

  function seedData() {
    var today = new Date();
    var iso = function (offsetDays, h, m) {
      var d = new Date(today.getFullYear(), today.getMonth(), today.getDate(), h || 0, m || 0);
      d.setDate(d.getDate() + offsetDays);
      return d.toISOString();
    };
    var isoDate = function (offsetDays) { return iso(offsetDays, 0, 0).slice(0, 10); };

    var w1 = {
      id: uid("w"), base: "木胎香盒", theme: "海水江崖", line: "细线", progress: 70,
      dryDate: isoDate(0), gold: "未处理", defect: "", delivery: isoDate(5),
      status: "待阴干", note: "边线需保持低浮雕感", logs: []
    };
    var w2 = {
      id: uid("w"), base: "脱胎盘", theme: "折枝梅", line: "混合线", progress: 95,
      dryDate: isoDate(-3), gold: "已上金粉", defect: "左侧枝干翘线",
      delivery: isoDate(-1), status: "上金粉", note: "客户要求金粉偏暗", logs: []
    };
    var w3 = {
      id: uid("w"), base: "竹胎笔筒", theme: "云雷纹", line: "中线", progress: 40,
      dryDate: isoDate(2), gold: "未处理", defect: "", delivery: isoDate(8),
      status: "贴线中", note: "", logs: []
    };

    var b1 = { id: uid("b"), code: "PH-2609-A", ash: "瓦灰砖灰 3:1", moisture: 8.6, active: true };
    var b2 = { id: uid("b"), code: "PH-2608-B", ash: "陈瓦灰回潮批", moisture: 13.4, active: true };
    var b3 = { id: uid("b"), code: "PH-2607-C", ash: "停用试配批", moisture: 7.9, active: false };

    var slots = [
      { id: uid("s"), code: "阴干柜 A-1" },
      { id: uid("s"), code: "阴干柜 A-2" },
      { id: uid("s"), code: "阴干柜 B-1" }
    ];

    /* w1 已登记初称与两次合格称重、批缝闭合，占 A-1，可直接试准入 */
    var repairedAt = Date.parse(iso(-2, 9, 0));
    var baseWeight = 320.0;
    var order1 = {
      id: uid("o"), workId: w1.id, batchId: b1.id, slotId: null,
      status: "open", reason: "盘口批缝开裂",
      repairer: "陈师傅", repairedAt: repairedAt, baseWeight: baseWeight,
      weighings: [], seamClosed: false, seamChecker: "",
      decision: null, events: []
    };
    var wg1 = { at: repairedAt + DAY, person: "林师傅", weight: +(baseWeight * (1 - 0.0038)).toFixed(2) };
    var wg2 = { at: repairedAt + 2 * DAY, person: "周师傅", weight: +(wg1.weight * (1 - 0.0041)).toFixed(2) };
    order1.weighings = [wg1, wg2];
    order1.slotId = slots[0].id;
    order1.status = "drying";
    order1.since = Date.parse(iso(-1, 9, 5));
    order1.seamClosed = true;
    order1.seamChecker = "林师傅";
    var ratio1 = ((baseWeight - wg1.weight) / baseWeight * 100).toFixed(3);
    var ratio2 = ((wg1.weight - wg2.weight) / wg1.weight * 100).toFixed(3);
    order1.events = [
      { at: repairedAt, text: "开补灰单（未结束），批次 PH-2609-A" },
      { at: repairedAt, text: "登记初称：" + baseWeight.toFixed(2) + "g，修补人 陈师傅" },
      { at: wg1.at, text: "第 1 次换人称重：林师傅，失重 " + ratio1 + "%" },
      { at: wg2.at, text: "第 2 次换人称重：周师傅，失重 " + ratio2 + "%" },
      { at: wg2.at + 3600000, text: "林师傅确认批缝闭合" },
      { at: order1.since, text: "占用 阴干柜 A-1" }
    ];

    var state = {
      works: [w1, w2, w3],
      batches: [b1, b2, b3],
      slots: slots,
      orders: [order1],
      history: []
    };
    state.history = [
      history("初始化：3 件作品、3 个补灰批次、3 个阴干柜位", "info"),
      history("木胎香盒 已开未结束补灰单，占 阴干柜 A-1，两次称重合格待准入", "order")
    ];
    return state;
  }

  function migrateLegacy() {
    var raw = null;
    try { raw = localStorage.getItem(LEGACY_KEY); } catch (e) { raw = null; }
    if (!raw) return null;
    var works;
    try { works = JSON.parse(raw); } catch (e) { return null; }
    if (!Array.isArray(works) || !works.length) return null;

    var slots = [
      { id: uid("s"), code: "阴干柜 A-1" },
      { id: uid("s"), code: "阴干柜 A-2" },
      { id: uid("s"), code: "阴干柜 B-1" }
    ];
    var batch = { id: uid("b"), code: "PH-迁移批", ash: "原工坊默认补灰批", moisture: 9.0, active: true };
    var migrated = works.map(function (w) {
      w.logs = (w.logs || []).map(function (text, i) {
        return { id: uid("lg"), at: Date.now() + i, text: String(text), type: "legacy" };
      });
      return w;
    });
    var state = { works: migrated, batches: [batch], slots: slots, orders: [], history: [
      history("从旧版工坊数据迁移 " + migrated.length + " 件作品，批次/柜位使用默认配置", "info")
    ] };
    return state;
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.works)) {
          parsed._inflight = {};
          return parsed;
        }
      } catch (e) { /* 损坏数据落到种子 */ }
    }
    var state = migrateLegacy() || seedData();
    state._inflight = {};
    return state;
  }

  var state = load();

  function persist() {
    var data = {
      works: state.works,
      batches: state.batches,
      slots: state.slots,
      orders: state.orders,
      history: state.history
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) { /* 存储不可用时仅保留内存态 */ }
  }

  function commit(text, type, refs) {
    state.history.unshift(history(text, type, refs));
    if (state.history.length > 300) state.history.length = 300;
    persist();
  }

  /* ---------- 只读查询 ---------- */

  function getWork(id) { return state.works.find(function (w) { return w.id === id; }); }
  function getBatch(id) { return state.batches.find(function (b) { return b.id === id; }); }
  function getSlot(id) { return state.slots.find(function (s) { return s.id === id; }); }

  function openOrderOf(workId) {
    return R.findOpenOrder(state.orders, workId);
  }

  function occupyingOrder(slotId) {
    return state.orders.find(function (o) {
      return o.slotId === slotId && o.status === "drying";
    });
  }

  function freeSlots() {
    return state.slots.filter(function (s) { return !occupyingOrder(s.id); });
  }

  function addWork(input) {
    var w = {
      id: uid("w"), base: input.base, theme: input.theme, line: input.line,
      progress: Number(input.progress) || 0, dryDate: input.dryDate,
      gold: input.gold, defect: input.defect || "", delivery: input.delivery,
      status: input.status, note: input.note || "",
      logs: [{ id: uid("lg"), at: Date.now(), text: "创建作品", type: "info" }]
    };
    state.works.unshift(w);
    commit("新增作品 " + w.theme + "（" + w.base + "）", "work", { workId: w.id });
    return w;
  }

  /* ---------- 补灰单生命周期 ---------- */

  /* 开单：每件作品仅一张未结束单；重复开单沿用首次结果 */
  function openRepairOrder(input) {
    var work = getWork(input.workId);
    if (!work) throw new Error("作品不存在");

    var existing = openOrderOf(work.id);
    if (existing) {
      return { reused: true, order: existing };
    }
    var vr = R.validateRepair(input);
    if (!vr.ok) throw new Error(vr.reasons.join("；"));

    var batch = getBatch(input.batchId);
    var ready = R.batchReady(batch);
    if (!ready.ok) throw new Error(ready.reason);

    var order = {
      id: uid("o"), workId: work.id, batchId: batch.id, slotId: null,
      status: "open", reason: String(input.reason || "").trim(),
      repairer: vr.repairer, repairedAt: vr.repairedAt, baseWeight: vr.baseWeight,
      weighings: [], seamClosed: false, seamChecker: "",
      decision: null, events: []
    };
    order.events.push({ at: Date.now(), text: "开补灰单（未结束），批次 " + batch.code + (order.reason ? "；原因：" + order.reason : "") });
    order.events.push({ at: Date.now(), text: "登记初称：" + order.baseWeight.toFixed(2) + "g，修补人 " + order.repairer });
    state.orders.push(order);
    commit(work.theme + " 开未结束补灰单，批次 " + batch.code, "order", { orderId: order.id, workId: work.id });
    return { reused: false, order: order };
  }

  /* 占阴干位：批次停用/含水率超 12% 拦截，柜位先空先占，重复占位沿用首次结果 */
  function occupySlot(orderId, slotId) {
    var order = state.orders.find(function (o) { return o.id === orderId; });
    if (!order) throw new Error("补灰单不存在");
    if (!R.isOpen(order)) throw new Error("补灰单已结束，不能再占阴干位");
    if (order.status === "drying" && order.slotId) {
      return { reused: true, order: order };
    }
    var batch = getBatch(order.batchId);
    var ready = R.batchReady(batch);
    if (!ready.ok) throw new Error(ready.reason);

    var slot = slotId ? getSlot(slotId) : freeSlots()[0];
    if (!slot) throw new Error("没有空闲阴干柜位");
    var holder = occupyingOrder(slot.id);
    if (holder) {
      var hw = getWork(holder.workId);
      throw new Error(slot.code + " 已被 " + (hw ? hw.theme : "其他作品") + " 占用");
    }

    order.slotId = slot.id;
    order.status = "drying";
    order.since = Date.now();
    order.events.push({ at: order.since, text: "占用 " + slot.code });
    var work = getWork(order.workId);
    commit(work.theme + " 占 " + slot.code + "（批次 " + batch.code + "）", "slot", { orderId: order.id, slotId: slot.id });
    return { reused: false, order: order };
  }

  function addWeighing(orderId, input) {
    var order = state.orders.find(function (o) { return o.id === orderId; });
    if (!order) throw new Error("补灰单不存在");
    if (!R.isOpen(order)) throw new Error("补灰单已结束");
    var v = R.validateWeighing(order, input);
    if (!v.ok) throw new Error(v.reasons.join("；"));

    order.weighings.push({ at: v.entry.at, person: v.entry.person, weight: v.entry.weight });
    order.decision = null; // 输入变化，首次判定结果作废，下次准入重新计算
    var prevWeight = order.weighings.length === 1
      ? order.baseWeight
      : order.weighings[order.weighings.length - 2].weight;
    var ratio = R.lossRatio(prevWeight, v.entry.weight);
    var band = R.inLossBand(ratio) ? "在区间内" : "超出 0.2%–0.6% 区间";
    var text = "第 " + order.weighings.length + " 次换人称重：" + v.entry.person +
      "，" + v.entry.weight.toFixed(2) + "g，失重 " + R.formatPercent(ratio) + "（" + band + "）";
    order.events.push({ at: Date.now(), text: text });
    var work = getWork(order.workId);
    commit(work.theme + " " + text, "weigh", { orderId: order.id });
    return order;
  }

  function setSeam(orderId, closed, checker) {
    var order = state.orders.find(function (o) { return o.id === orderId; });
    if (!order) throw new Error("补灰单不存在");
    if (!R.isOpen(order)) throw new Error("补灰单已结束");
    var person = String(checker || "").trim();
    if (closed && !person) throw new Error("请填写批缝确认人");
    order.seamClosed = !!closed;
    order.seamChecker = closed ? person : "";
    order.decision = null;
    var text = closed ? person + " 确认批缝闭合" : "撤销批缝闭合标记";
    order.events.push({ at: Date.now(), text: text });
    var work = getWork(order.workId);
    commit(work.theme + " " + text, "seam", { orderId: order.id });
    return order;
  }

  /*
   * 准入判定：
   * - 判定结果按输入指纹缓存（order.decision），指纹不变重复触发沿用首次结果；
   * - 并发触发合并为同一个 Promise；
   * - 通过：结束补灰单、释放柜位、作品进入上金粉；
   * - 不通过：继续占位。
   */
  function requestAdmission(orderId) {
    if (state._inflight[orderId]) return state._inflight[orderId];

    var p = new Promise(function (resolve) {
      setTimeout(function () {
        var order = state.orders.find(function (o) { return o.id === orderId; });
        if (!order) { delete state._inflight[orderId]; return resolve({ passed: false, reasons: ["补灰单不存在"] }); }

        // 已准入为不可变的历史结论（胎体/纹样修正会在 correctWork 中作废），重复触发沿用首次结果
        if (order.status === "done" && order.decision) {
          delete state._inflight[orderId];
          return resolve(Object.assign({ reused: true }, order.decision));
        }

        var work = getWork(order.workId);
        var batch = getBatch(order.batchId);
        var result = R.evaluate(order, work, batch);

        if (order.decision && order.decision.fingerprint === result.fingerprint) {
          // 指纹未变：沿用首次判定结果，不重复落履历
          delete state._inflight[orderId];
          return resolve(Object.assign({ reused: true }, order.decision));
        }

        order.decision = {
          fingerprint: result.fingerprint,
          passed: result.passed,
          reasons: result.reasons,
          ratios: result.ratios,
          at: Date.now()
        };

        if (result.passed) {
          var slot = getSlot(order.slotId);
          order.status = "done";
          order.endedAt = Date.now();
          order.slotId = null;
          work.status = "上金粉";
          work.gold = work.gold === "未处理" ? "试扫粉" : work.gold;
          order.events.push({ at: order.endedAt, text: "准入金粉：两段失重均在区间且批缝闭合，释放 " + (slot ? slot.code : "柜位") });
          commit(work.theme + " 通过复阴准入，进入金粉工序，释放 " + (slot ? slot.code : "柜位"), "pass",
            { orderId: order.id, workId: work.id });
        } else {
          order.events.push({ at: Date.now(), text: "准入未通过，继续占位：" + result.reasons.join("；") });
          commit(work.theme + " 准入未通过，继续占阴干位：" + result.reasons.join("；"), "fail",
            { orderId: order.id });
        }
        persist();
        delete state._inflight[orderId];
        resolve(Object.assign({ reused: false }, order.decision));
      }, 120);
    });

    state._inflight[orderId] = p;
    return p;
  }

  /* 手工结束未结束单（判定作废，不进入金粉，释放柜位） */
  function closeOrder(orderId, note) {
    var order = state.orders.find(function (o) { return o.id === orderId; });
    if (!order) throw new Error("补灰单不存在");
    if (!R.isOpen(order)) throw new Error("补灰单已结束");
    var slot = order.slotId ? getSlot(order.slotId) : null;
    order.status = "closed";
    order.endedAt = Date.now();
    order.endNote = String(note || "").trim();
    order.decision = null;
    order.slotId = null;
    var text = "结束补灰单（未准入金粉）" + (slot ? "，释放 " + slot.code : "") +
      (order.endNote ? "；" + order.endNote : "");
    order.events.push({ at: order.endedAt, text: text });
    var work = getWork(order.workId);
    commit(work.theme + " " + text, "close", { orderId: order.id });
    return order;
  }

  /* 批次维护：停用 / 改含水率，判定缓存按新值自动失效 */
  function saveBatch(input) {
    var b;
    if (input.id) {
      b = getBatch(input.id);
      if (!b) throw new Error("批次不存在");
    } else {
      b = { id: uid("b") };
      state.batches.push(b);
    }
    b.code = String(input.code).trim();
    b.ash = String(input.ash || "").trim();
    b.moisture = Number(input.moisture);
    b.active = input.active !== false;
    if (!b.code) throw new Error("批次编号必填");
    if (!(b.moisture >= 0)) throw new Error("含水率需为非负数字");
    state.orders.forEach(function (o) {
      if (o.batchId === b.id && o.decision) o.decision = null;
    });
    commit("批次 " + b.code + " 保存：含水率 " + b.moisture + "%，" + (b.active ? "启用中" : "已停用"), "batch",
      { batchId: b.id });
    return b;
  }

  /*
   * 胎体或纹样修正：准入失效并按新值重算。
   * - 已准入（done）：准入失效，退回待阴干、释放柜位，须重新开单；
   * - 补灰中/占阴干中：清空初称、称重、批缝与判定，drying 单继续占位（补灰批次停用/超含水率不得占位的约束仅在占柜动作时拦截既有占位）。
   */
  function correctWork(id, patch) {
    var w = getWork(id);
    if (!w) throw new Error("作品不存在");
    var nextBase = String(patch.base || "").trim();
    var nextTheme = String(patch.theme || "").trim();
    if (!nextBase || !nextTheme) throw new Error("胎体材质与纹样主题必填");
    var changed = nextBase !== w.base || nextTheme !== w.theme;

    w.base = nextBase;
    w.theme = nextTheme;
    if (typeof patch.note === "string") w.note = patch.note;
    w.logs.push({ id: uid("lg"), at: Date.now(), text: "胎体/纹样修正：准入结果失效，按新值重算", type: "correct" });

    var affected = state.orders.filter(function (o) { return o.workId === id; });
    affected.forEach(function (o) {
      if (o.status === "done") {
        o.voided = true;
        o.status = "closed";
        o.endedAt = Date.now();
        o.endNote = "胎体/纹样修正，准入失效";
        o.slotId = null;
        o.decision = null;
        o.events.push({ at: Date.now(), text: "胎体/纹样修正：准入失效，退回待阴干，需重新开补灰单" });
        w.status = "待阴干";
        w.gold = "未处理";
      } else if (R.isOpen(o)) {
        o.repairer = "";
        o.repairedAt = null;
        o.baseWeight = null;
        o.weighings = [];
        o.seamClosed = false;
        o.seamChecker = "";
        o.decision = null;
        o.events.push({ at: Date.now(), text: "胎体/纹样修正：初称、称重与判定清空，按新值重算" +
          (o.status === "drying" ? "，继续占阴干位" : "") });
      }
    });

    if (changed) {
      commit(w.theme + " 修正胎体/纹样，相关准入全部失效并按新值重算", "correct",
        { workId: w.id });
    } else {
      persist();
    }
    return w;
  }

  function updateStatus(id, status) {
    var w = getWork(id);
    if (!w) throw new Error("作品不存在");
    w.status = status;
    if (status === "待阴干") w.dryDate = new Date().toISOString().slice(0, 10);
    if (status === "上金粉") w.gold = "已上金粉";
    if (status === "待交付") w.progress = 100;
    w.logs.push({ id: uid("lg"), at: Date.now(), text: "更新为 " + status, type: "status" });
    commit(w.theme + " 状态更新为 " + status, "status", { workId: w.id });
  }

  function recordDefect(id, text) {
    var w = getWork(id);
    if (!w) throw new Error("作品不存在");
    var value = String(text || "").trim();
    if (!value) throw new Error("请填写缺陷位置");
    w.defect = w.defect ? w.defect + "; " + value : value;
    w.logs.push({ id: uid("lg"), at: Date.now(), text: "缺陷：" + value, type: "defect" });
    commit(w.theme + " 记录缺陷：" + value, "defect", { workId: w.id });
  }

  function exportJSON() {
    return JSON.stringify({
      works: state.works, batches: state.batches, slots: state.slots,
      orders: state.orders, history: state.history
    }, null, 2);
  }

  global.QXStore = {
    state: state,
    // 查询
    getWork: getWork,
    getBatch: getBatch,
    getSlot: getSlot,
    openOrderOf: openOrderOf,
    occupyingOrder: occupyingOrder,
    freeSlots: freeSlots,
    // 变更
    addWork: addWork,
    openRepairOrder: openRepairOrder,
    occupySlot: occupySlot,
    addWeighing: addWeighing,
    setSeam: setSeam,
    requestAdmission: requestAdmission,
    closeOrder: closeOrder,
    saveBatch: saveBatch,
    correctWork: correctWork,
    updateStatus: updateStatus,
    recordDefect: recordDefect,
    exportJSON: exportJSON
  };
})(window);
