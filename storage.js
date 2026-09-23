/*
 * 批缝补灰与复阴准入台 —— 存储层
 * 持久化四类数据：作品、补灰批次、补灰单、阴干柜位占用；履历挂在作品 logs 与补灰单 events 上。
 * 所有写操作都立即落盘，看板/柜位/履历刷新后保持一致。
 */
(function () {
  "use strict";

  const R = window.Rules;
  const KEYS = {
    works: "zfl42Works",
    batches: "qxf42Batches",
    orders: "qxf42Orders",
    version: "qxf42Version"
  };
  const VERSION = 2;

  function isoHoursAgo(hours) {
    return new Date(Date.now() - hours * 3600000).toISOString();
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function todayText() {
    return new Date().toISOString().slice(0, 10);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.warn("读取失败：" + key, e);
    }
    return clone(fallback);
  }

  function seedData() {
    const today = todayText();

    const b1 = { id: R.uuid(), name: "瓦灰·夏用批", moisture: 9.4, active: true, note: "常配夏布批缝", createdAt: isoHoursAgo(120) };
    const b2 = { id: R.uuid(), name: "瓦灰·梅雨批", moisture: 13.6, active: true, note: "近期回潮，暂停上柜", createdAt: isoHoursAgo(96) };
    const b3 = { id: R.uuid(), name: "老粉灰·旧批", moisture: 8.1, active: false, note: "停用观察", createdAt: isoHoursAgo(200) };

    const w1Id = R.uuid();
    const w2Id = R.uuid();
    const w3Id = R.uuid();
    const o1Id = R.uuid();

    const w1 = {
      id: w1Id, base: "木胎香盒", theme: "海水江崖", line: "细线", progress: 70,
      dryDate: today, gold: "未处理", defect: "", delivery: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
      status: "待阴干", note: "边线需保持低浮雕感",
      logs: [
        isoHoursAgo(72) + " 创建作品",
        isoHoursAgo(30) + " 开出补灰单 " + o1Id.slice(0, 8) + "（瓦灰·夏用批）",
        isoHoursAgo(30) + " 修补完成：初重 120.0g，修补人 陈师傅",
        isoHoursAgo(30) + " 占用柜位 A1",
        isoHoursAgo(26) + " 第一次称重 119.52g（林师傅），失重 0.400%",
        isoHoursAgo(2) + " 第二次称重 119.00g（林师傅），失重 0.435%；批缝已闭合"
      ]
    };

    const o1 = {
      id: o1Id, workId: w1Id, batchId: b1.id,
      slotId: "A1",
      repairer: "陈师傅", repairWeight: 120.0, repairedAt: isoHoursAgo(30),
      seamClosed: true,
      weighings: [
        { at: isoHoursAgo(26), person: "林师傅", weight: 119.52 },
        { at: isoHoursAgo(2), person: "林师傅", weight: 119.0 }
      ],
      status: "open",
      eval: null,
      events: [
        isoHoursAgo(30) + " 开出补灰单",
        isoHoursAgo(30) + " 占用柜位 A1",
        isoHoursAgo(26) + " 第一次称重：林师傅 119.52g",
        isoHoursAgo(2) + " 第二次称重：林师傅 119.00g；批缝闭合"
      ],
      createdAt: isoHoursAgo(30), finishedAt: null, finishReason: null
    };

    const o2 = {
      id: R.uuid(), workId: w2Id, batchId: b2.id,
      slotId: null,
      repairer: "", repairWeight: null, repairedAt: null,
      seamClosed: false, weighings: [],
      status: "open", eval: null,
      events: [isoHoursAgo(6) + " 开出补灰单（批次含水率超标，暂不得占柜位）"],
      createdAt: isoHoursAgo(6), finishedAt: null, finishReason: null
    };

    const w2 = {
      id: w2Id, base: "脱胎盘", theme: "折枝梅", line: "混合线", progress: 90,
      dryDate: today, gold: "试扫粉", defect: "左侧枝干翘线", delivery: new Date(Date.now() + 1 * 86400000).toISOString().slice(0, 10),
      status: "待阴干", note: "客户要求金粉偏暗；批缝补灰待复阴",
      logs: [
        isoHoursAgo(80) + " 创建作品",
        isoHoursAgo(50) + " 记录翘线",
        isoHoursAgo(6) + " 开出补灰单（" + o2.id.slice(0, 8) + "）"
      ]
    };

    const w3 = {
      id: w3Id, base: "竹胎笔筒", theme: "云雷纹", line: "中线", progress: 40,
      dryDate: new Date(Date.now() + 1 * 86400000).toISOString().slice(0, 10),
      gold: "未处理", defect: "", delivery: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      status: "贴线中", note: "",
      logs: [isoHoursAgo(10) + " 创建作品"]
    };

    return {
      works: [w2, w1, w3],
      batches: [b1, b2, b3],
      orders: [o2, o1]
    };
  }

  let state;

  function persist() {
    localStorage.setItem(KEYS.works, JSON.stringify(state.works));
    localStorage.setItem(KEYS.batches, JSON.stringify(state.batches));
    localStorage.setItem(KEYS.orders, JSON.stringify(state.orders));
    localStorage.setItem(KEYS.version, String(VERSION));
  }

  function reset() {
    state = seedData();
    persist();
    return snapshot();
  }

  function init() {
    const version = localStorage.getItem(KEYS.version);
    if (version === String(VERSION)) {
      state = {
        works: load(KEYS.works, []),
        batches: load(KEYS.batches, []),
        orders: load(KEYS.orders, [])
      };
    } else {
      // 旧版单文件数据（zfl42Works）不直接迁移，按演示数据重新建立完整业务模型
      state = seedData();
      persist();
    }
  }

  function snapshot() {
    return {
      works: clone(state.works),
      batches: clone(state.batches),
      orders: clone(state.orders),
      slots: R.SLOTS.slice()
    };
  }

  // ---------- 履历 ----------
  function logEvent(text) {
    return nowIso() + " " + text;
  }
  function pushWorkLog(work, text) {
    work.logs = work.logs || [];
    work.logs.push(logEvent(text));
  }
  function pushOrderEvent(order, text) {
    order.events = order.events || [];
    order.events.push(logEvent(text));
  }

  // ---------- 作品 ----------
  function getWork(id) {
    const w = state.works.find(x => x.id === id);
    if (!w) throw new Error("作品不存在");
    return w;
  }

  function addWork(data) {
    const work = {
      id: R.uuid(),
      base: data.base, theme: data.theme, line: data.line,
      progress: Number(data.progress) || 0,
      dryDate: data.dryDate, gold: data.gold, defect: data.defect || "",
      delivery: data.delivery, status: data.status, note: data.note || "",
      logs: [logEvent("创建作品")]
    };
    state.works.unshift(work);
    persist();
    return work;
  }

  function updateWorkStatus(id, status) {
    const w = getWork(id);
    w.status = status;
    if (status === "待阴干") w.dryDate = todayText();
    if (status === "上金粉") w.gold = "已上金粉";
    if (status === "待交付") w.progress = 100;
    pushWorkLog(w, "更新状态为 " + status);
    persist();
    return w;
  }

  function recordDefect(id, text) {
    const w = getWork(id);
    if (!text) return w;
    w.defect = w.defect ? w.defect + "; " + text : text;
    pushWorkLog(w, "缺陷：" + text);
    persist();
    return w;
  }

  // 胎体或纹样修正：补灰单准入结果失效，按新值重算；若已上金粉则退回待阴干
  function correctDesign(id, field, value) {
    if (!["base", "theme"].includes(field)) throw new Error("仅胎体、纹样可作修正");
    const w = getWork(id);
    const oldValue = w[field];
    const label = field === "base" ? "胎体" : "纹样";
    if (!value || oldValue === value) return w;
    w[field] = value;
    pushWorkLog(w, label + "修正：" + oldValue + " → " + value + "，旧准入结果作废，按新值重算");

    const order = openOrderOf(w.id);
    if (order) {
      order.eval = null;
      pushOrderEvent(order, label + "修正，准入结果失效，等待重新判定");
      if (w.status === "上金粉") {
        w.status = "待阴干";
        pushWorkLog(w, "已上金粉，因" + label + "修正退回待阴干");
      }
    }
    persist();
    return w;
  }

  // ---------- 补灰批次 ----------
  function listBatches() { return clone(state.batches); }
  function getBatch(id) { return state.batches.find(b => b.id === id); }

  function addBatch(data) {
    const batch = {
      id: R.uuid(),
      name: data.name,
      moisture: Number(data.moisture),
      active: true,
      note: data.note || "",
      createdAt: nowIso()
    };
    state.batches.push(batch);
    persist();
    return batch;
  }

  function updateBatch(id, patch) {
    const b = getBatch(id);
    if (!b) throw new Error("补灰批次不存在");
    const before = { active: b.active, moisture: b.moisture };
    if (typeof patch.active === "boolean") b.active = patch.active;
    if (patch.moisture != null && patch.moisture !== "") b.moisture = Number(patch.moisture);
    if (patch.note !== undefined) b.note = patch.note;

    const changes = [];
    if (before.active !== b.active) changes.push("停用状态 " + (b.active ? "启用" : "停用"));
    if (Number(before.moisture) !== Number(b.moisture)) changes.push("含水率 " + before.moisture + "% → " + b.moisture + "%");
    if (changes.length) {
      state.orders.filter(o => o.status === "open").forEach(o => {
        if (o.batchId !== b.id) return;
        pushOrderEvent(o, "批次调整：" + changes.join("，") + "，准入结果按新值重算");
        o.eval = null;
        const work = getWork(o.workId);
        pushWorkLog(work, "补灰批次调整（" + changes.join("，") + "），判定缓存失效");
      });
    }
    persist();
    reconcileSlots();
    return b;
  }

  // ---------- 补灰单 ----------
  function listOrders() { return clone(state.orders); }
  function getOrder(id) {
    const o = state.orders.find(x => x.id === id);
    if (!o) throw new Error("补灰单不存在");
    return o;
  }
  function openOrderOf(workId) {
    return state.orders.find(o => o.workId === workId && o.status === "open") || null;
  }

  function openOrderForBatch(batchId) {
    return state.orders.find(o => o.batchId === batchId && o.status === "open") || null;
  }

  function occupiedSlotIds(exceptOrderId) {
    return new Set(state.orders
      .filter(o => o.status === "open" && o.slotId && o.id !== exceptOrderId)
      .map(o => o.slotId));
  }

  function orderAtSlot(slotId) {
    return state.orders.find(o => o.status === "open" && o.slotId === slotId) || null;
  }

  function createOrder(workId, batchId) {
    const w = getWork(workId);
    if (openOrderOf(workId)) throw new Error("该作品已有未结束补灰单，每件作品仅允许一张");
    const batch = getBatch(batchId);
    if (!batch) throw new Error("补灰批次不存在");

    const order = {
      id: R.uuid(), workId: workId, batchId: batchId,
      slotId: null,
      repairer: "", repairWeight: null, repairedAt: null,
      seamClosed: false, weighings: [],
      status: "open", eval: null,
      events: [logEvent("开出补灰单，使用批次「" + batch.name + "」")],
      createdAt: nowIso(), finishedAt: null, finishReason: null
    };
    state.orders.push(order);
    pushWorkLog(w, "开出补灰单 " + order.id.slice(0, 8) + "（" + batch.name + "）");

    if (!R.batchUsable(batch)) {
      const why = R.batchProblems(batch).join("；");
      order.events.push(logEvent("占柜位被拦截：" + why));
      pushWorkLog(w, "占阴干柜位被拦截：" + why);
    }
    persist();
    return order;
  }

  function occupySlot(orderId, slotId) {
    const order = getOrder(orderId);
    if (order.status !== "open") throw new Error("补灰单已结束");
    if (!R.SLOTS.includes(slotId)) throw new Error("柜位不存在");
    const batch = getBatch(order.batchId);
    const problems = R.batchProblems(batch);
    if (problems.length) throw new Error("不得占用柜位：" + problems.join("；"));
    const taken = occupiedSlotIds(order.id);
    if (taken.has(slotId)) throw new Error("柜位 " + slotId + " 已被其他补灰单占用");

    const from = order.slotId;
    order.slotId = slotId;
    order.eval = null; // 柜位变化属于判定输入变化，需重算
    pushOrderEvent(order, (from ? "柜位 " + from + " 调整至 " : "占用柜位 ") + slotId);
    const w = getWork(order.workId);
    pushWorkLog(w, (from ? "调整阴干柜位：" + from + " → " : "占用阴干柜位 ") + slotId);
    persist();
    return order;
  }

  function releaseSlot(orderId, reason) {
    const order = getOrder(orderId);
    if (!order.slotId) return order;
    const slot = order.slotId;
    order.slotId = null;
    pushOrderEvent(order, "释放柜位 " + slot + "（" + reason + "）");
    pushWorkLog(getWork(order.workId), "释放阴干柜位 " + slot + "（" + reason + "）");
    persist();
    return order;
  }

  function setRepair(orderId, data) {
    const order = getOrder(orderId);
    if (order.status !== "open") throw new Error("补灰单已结束");
    order.repairer = String(data.repairer || "").trim();
    order.repairWeight = Number(data.repairWeight);
    order.repairedAt = data.repairedAt ? new Date(data.repairedAt).toISOString() : nowIso();
    order.eval = null;
    order.weighings = []; // 重登记修补信息后，旧称重链路作废
    order.seamClosed = false;
    pushOrderEvent(order, "修补完成：初重 " + order.repairWeight + "g，修补人 " + order.repairer);
    pushWorkLog(getWork(order.workId), "补灰完成，初重 " + order.repairWeight + "g，修补人 " + order.repairer);
    persist();
    return order;
  }

  function addWeighing(orderId, data) {
    const order = getOrder(orderId);
    if (order.status !== "open") throw new Error("补灰单已结束");
    if (!(Number(order.repairWeight) > 0)) throw new Error("请先登记修补初重");
    if ((order.weighings || []).length >= R.REQUIRED_WEIGHINGS) {
      throw new Error("两次称重已完成；若数据有变请重新登记修补信息");
    }
    const person = String(data.person || "").trim();
    const weight = Number(data.weight);
    const at = data.at ? new Date(data.at).toISOString() : nowIso();
    if (!person) throw new Error("称重人必填");
    if (!(weight > 0)) throw new Error("重量无效");
    if (order.repairer && person === order.repairer) {
      throw new Error("称重人必须与修补人换人（修补人：" + order.repairer + "）");
    }
    const seq = order.weighings.length + 1;
    order.weighings.push({ at: at, person: person, weight: weight });
    order.eval = null;

    const prev = seq === 1 ? Number(order.repairWeight) : Number(order.weighings[seq - 2].weight);
    const ratio = R.lossRatio(prev, weight);
    pushOrderEvent(order, "第" + seq + "次称重：" + person + " " + weight + "g，失重 " + R.pct(ratio) +
      (R.inBand(ratio) ? "（在 0.20%~0.60% 区间）" : "（超出 0.20%~0.60% 区间）"));
    pushWorkLog(getWork(order.workId), "第" + seq + "次称重 " + weight + "g（" + person + "），失重 " + R.pct(ratio));
    persist();
    return order;
  }

  function setSeam(orderId, closed) {
    const order = getOrder(orderId);
    if (order.status !== "open") throw new Error("补灰单已结束");
    if (order.seamClosed !== !!closed) {
      order.seamClosed = !!closed;
      order.eval = null;
      pushOrderEvent(order, "批缝" + (closed ? "已闭合" : "重新标记为未闭合"));
      pushWorkLog(getWork(order.workId), "批缝" + (closed ? "闭合" : "未闭合"));
      persist();
    }
    return order;
  }

  // 准入判定（含重复/并发沿用首次结果），结果写回后由调用方处理通过分支
  async function judge(orderId) {
    const order = getOrder(orderId);
    if (order.status !== "open") throw new Error("补灰单已结束");
    const w = getWork(order.workId);
    const batch = getBatch(order.batchId);
    const result = await R.evaluateAdmission(order, w, batch);

    // Promise 完成后再核对：期间若已结束或以更新指纹覆盖，则以最新数据为准
    const fresh = getOrder(orderId);
    if (fresh.status !== "open") throw new Error("补灰单已结束");
    if (R.signature(fresh, getWork(fresh.workId), getBatch(fresh.batchId)) !== result.sig) {
      return judge(orderId); // 输入已变化，按新值重算
    }
    if (!fresh.eval || fresh.eval.sig !== result.sig) {
      fresh.eval = result;
      pushOrderEvent(fresh, result.verdict === "pass"
        ? "准入判定通过：复阴合格，准入金粉"
        : "准入判定未通过：" + result.problems.join("；") + "；继续占位");
      pushWorkLog(getWork(fresh.workId), result.verdict === "pass"
        ? "复阴准入通过，可上金粉"
        : "复阴准入未通过：" + result.problems.join("；"));
      persist();
    }
    return { order: getOrder(orderId), result: fresh.eval };
  }

  // 判定通过后收口：结束补灰单、释放柜位、作品进入上金粉
  function admit(orderId) {
    const order = getOrder(orderId);
    const w = getWork(order.workId);
    const batch = getBatch(order.batchId);
    const current = R.evaluate(order, w, batch);
    if (current.verdict !== "pass") {
      throw new Error("当前条件不满足准入，继续占位：" + current.problems.join("；"));
    }
    const slot = order.slotId;
    order.status = "closed";
    order.finishedAt = nowIso();
    order.finishReason = "admitted";
    order.eval = Object.assign({}, order.eval || current, { verdict: "pass" });
    if (slot) {
      pushOrderEvent(order, "准入金粉，释放柜位 " + slot);
      order.slotId = null;
    }
    w.status = "上金粉";
    w.gold = "已上金粉";
    pushWorkLog(w, "补灰单结束，准入金粉" + (slot ? "，释放柜位 " + slot : ""));
    persist();
    return order;
  }

  // 放弃/作废补灰单（未准入的结束路径）
  function closeOrder(orderId, reason) {
    const order = getOrder(orderId);
    const slot = order.slotId;
    order.status = "closed";
    order.finishedAt = nowIso();
    order.finishReason = reason || "abandoned";
    order.eval = null;
    const text = "补灰单结束（" + (reason || "作废") + "）" + (slot ? "，释放柜位 " + slot : "");
    pushOrderEvent(order, text);
    pushWorkLog(getWork(order.workId), text);
    order.slotId = null;
    persist();
    return order;
  }

  // 柜位与批次规则对账：停用/含水率超标的开放补灰单不得继续占位（刷新后也一致）
  function reconcileSlots() {
    let changed = false;
    state.orders.forEach(order => {
      if (order.status !== "open" || !order.slotId) return;
      const batch = getBatch(order.batchId);
      const problems = R.batchProblems(batch);
      if (problems.length) {
        const slot = order.slotId;
        order.slotId = null;
        order.eval = null;
        pushOrderEvent(order, "规则对账：释放柜位 " + slot + "（" + problems.join("；") + "）");
        pushWorkLog(getWork(order.workId), "批次规则变化，释放柜位 " + slot);
        changed = true;
      }
    });
    if (changed) persist();
    return changed;
  }

  init();
  // 启动即对账：批次停用/回潮后再打开页面，柜位视图不会出现违规占用
  reconcileSlots();
  persist();

  window.Store = {
    KEYS: KEYS,
    snapshot: snapshot,
    reset: reset,
    persist: persist,
    getWork: getWork,
    addWork: addWork,
    updateWorkStatus: updateWorkStatus,
    recordDefect: recordDefect,
    correctDesign: correctDesign,
    listBatches: listBatches,
    getBatch: getBatch,
    addBatch: addBatch,
    updateBatch: updateBatch,
    listOrders: listOrders,
    getOrder: getOrder,
    openOrderOf: openOrderOf,
    occupiedSlotIds: occupiedSlotIds,
    orderAtSlot: orderAtSlot,
    createOrder: createOrder,
    occupySlot: occupySlot,
    releaseSlot: releaseSlot,
    setRepair: setRepair,
    addWeighing: addWeighing,
    setSeam: setSeam,
    judge: judge,
    admit: admit,
    closeOrder: closeOrder,
    reconcileSlots: reconcileSlots
  };
})();
