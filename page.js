/*
 * 批缝补灰与复阴准入台 —— 页面层
 * 看板、阴干柜位、履历三块视图均由同一份 Store 快照渲染，任何写操作后立即整体刷新。
 */
(function () {
  "use strict";

  const R = window.Rules;
  const S = window.Store;

  const statuses = ["贴线中", "待阴干", "上金粉", "待交付"];
  const today = new Date().toISOString().slice(0, 10);

  const $ = sel => document.querySelector(sel);

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
  }

  function fmt(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString("zh-CN", { hour12: false });
  }

  function dtLocal(d) {
    d = d || new Date();
    const p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      "T" + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function run(fn) {
    try {
      fn();
    } catch (e) {
      alert(e.message || String(e));
    }
    render();
  }

  async function runAsync(fn, btn) {
    if (btn) btn.disabled = true;
    try {
      await fn();
    } catch (e) {
      alert(e.message || String(e));
    } finally {
      if (btn) btn.disabled = false;
    }
    render();
  }

  // ---------- 数据便捷读取 ----------
  function data() {
    const snap = S.snapshot();
    const workById = Object.fromEntries(snap.works.map(w => [w.id, w]));
    const batchById = Object.fromEntries(snap.batches.map(b => [b.id, b]));
    const openByWork = {};
    snap.orders.filter(o => o.status === "open").forEach(o => { openByWork[o.workId] = o; });
    return { snap: snap, works: snap.works, batches: snap.batches, orders: snap.orders, workById, batchById, openByWork };
  }

  function evalIsCurrent(order, work, batch) {
    return !!(order.eval && R.signature(order, work, batch) === order.eval.sig);
  }

  // ---------- 顶部三小栏 ----------
  function renderSummaries(d) {
    const todayDry = d.works.filter(w => w.dryDate <= today && w.status === "待阴干");
    const defects = d.works.filter(w => w.defect);
    const delivery = [...d.works].sort((a, b) => a.delivery.localeCompare(b.delivery)).slice(0, 4);
    const occupied = d.orders.filter(o => o.status === "open" && o.slotId).length;

    $("#todayDry").innerHTML = todayDry.length ? todayDry.map(w =>
      `<div class="item" onclick="Page.showDetail('${w.id}')"><b>${esc(w.theme)}</b><div class="meta">${esc(w.base)} · ${esc(w.dryDate)}</div></div>`
    ).join("") : `<div class="empty">暂无</div>`;

    $("#defectList").innerHTML = defects.length ? defects.map(w =>
      `<div class="item overdue" onclick="Page.showDetail('${w.id}')"><b>${esc(w.theme)}</b><div class="meta">${esc(w.defect)}</div></div>`
    ).join("") : `<div class="empty">暂无</div>`;

    $("#deliveryList").innerHTML = delivery.map(w =>
      `<div class="item" onclick="Page.showDetail('${w.id}')"><b>${esc(w.theme)}</b><div class="meta">${esc(w.delivery)} · ${esc(w.status)}</div></div>`
    ).join("");

    $("#slotSummary").textContent = `柜位 ${occupied}/${R.SLOTS.length} 占用`;
  }

  // ---------- 补灰批次面板 ----------
  function renderBatches(d) {
    $("#batchList").innerHTML = d.batches.map(b => {
      const problems = R.batchProblems(b);
      const open = d.orders.find(o => o.batchId === b.id && o.status === "open");
      return `<div class="batch-row ${b.active ? "" : "off"} ${problems.length ? "blocked" : ""}">
        <div class="batch-head">
          <b>${esc(b.name)}</b>
          <span class="badge ${problems.length ? "bad" : "ok"}">${b.active ? "启用中" : "已停用"}</span>
        </div>
        <label>含水率（%）
          <input type="number" step="0.1" min="0" value="${esc(b.moisture)}"
                 onchange="Page.setBatchMoisture('${b.id}', this.value)">
        </label>
        <div class="actions">
          <button class="${b.active ? "warn" : "secondary"}"
                  onclick="Page.toggleBatch('${b.id}')">${b.active ? "停用批次" : "启用批次"}</button>
        </div>
        <div class="meta">${esc(b.note || "无备注")}</div>
        ${problems.length ? `<div class="reason">${esc(problems.join("；"))}${open ? "（补灰单占柜将被拦截/清退）" : ""}</div>` : ""}
      </div>`;
    }).join("");
  }

  // ---------- 看板卡片上的补灰单片段 ----------
  function orderCardHtml(d, work) {
    const order = d.openByWork[work.id];
    if (!order) {
      return `<div class="order-box none">
        <div class="meta">无未结束补灰单</div>
        <div class="actions"><button class="violet" onclick="Page.createOrderPrompt('${work.id}')">开补灰单</button></div>
      </div>`;
    }
    const batch = d.batchById[order.batchId];
    const problems = R.batchProblems(batch);
    const stats = R.weighingStats(order);
    const weighText = stats.length
      ? stats.map(s => `<span class="${s.inBand ? "ok-text" : "bad-text"}">${s.label} ${s.ratioText}</span>`).join("　")
      : `<span class="meta">尚未称重</span>`;
    const current = evalIsCurrent(order, work, batch);
    const pass = current && order.eval.verdict === "pass";
    const evalBadge = order.eval
      ? (current
        ? `<span class="badge ${pass ? "ok" : "bad"}">${pass ? "判定通过·可准入" : "判定未过·继续占位"}</span>`
        : `<span class="badge stale">判定已失效（输入变化，待重算）</span>`)
      : `<span class="badge stale">尚未判定</span>`;

    return `<div class="order-box ${pass ? "pass" : ""}" onclick="event.stopPropagation()">
      <div class="order-head">补灰单 ${esc(order.id.slice(0, 8))} · ${esc(batch ? batch.name : "批次缺失")} ${evalBadge}</div>
      <div class="meta">
        柜位：${order.slotId ? "<b>" + esc(order.slotId) + "</b>" : "未占位"}
        ${problems.length ? `<div class="reason">${esc(problems.join("；"))}</div>` : ""}
      </div>
      <div class="meta">修补：${esc(order.repairer || "未登记")} · ${order.repairWeight ? esc(order.repairWeight) + "g · " + esc(fmt(order.repairedAt)) : "初重未登记"}</div>
      <div class="weigh-line">${weighText}</div>
      <div class="meta">批缝：${order.seamClosed ? "<span class='ok-text'>已闭合</span>" : "<span class='bad-text'>未闭合</span>"}</div>
      <div class="actions">
        <button class="secondary" onclick="Page.openOrderDesk('${order.id}')">补灰单台</button>
        <button class="violet" onclick="Page.judge('${order.id}', this)">准入判定</button>
        ${pass ? `<button onclick="Page.admit('${order.id}')">准入金粉</button>` : ""}
      </div>
    </div>`;
  }

  function renderBoard(d) {
    const theme = $("#themeFilter").value.trim();
    const status = $("#statusFilter").value;
    const sortKey = $("#sortMode").value;
    const list = d.works
      .filter(w => !status || w.status === status)
      .filter(w => !theme || w.theme.includes(theme))
      .sort((a, b) => (a[sortKey] || "").localeCompare(b[sortKey] || ""));

    $("#board").innerHTML = statuses.map(status => {
      const cards = list.filter(w => w.status === status);
      return `<section class="col">
        <h3><span>${status}</span><span>${cards.length}</span></h3>
        ${cards.length ? cards.map(w => `<article class="item ${w.defect ? "overdue" : ""}" onclick="Page.showDetail('${w.id}')">
          <b>${esc(w.theme)}</b>
          <div class="meta">${esc(w.base)} · ${esc(w.line)}<br>进度 ${esc(w.progress)}% · 阴干 ${esc(w.dryDate)}<br>金粉：${esc(w.gold)} · 交付：${esc(w.delivery)}<br>${w.defect ? "缺陷：" + esc(w.defect) : "缺陷：无"}</div>
          ${orderCardHtml(d, w)}
          <div class="actions" onclick="event.stopPropagation()">
            ${statuses.map(s => `<button class="${s === w.status ? "secondary" : ""}" onclick="Page.updateStatus('${w.id}', '${s}')">${s}</button>`).join("")}
            <button class="warn" onclick="Page.recordDefect('${w.id}')">记缺陷</button>
          </div>
        </article>`).join("") : `<div class="empty">暂无作品</div>`}
      </section>`;
    }).join("");
  }

  // ---------- 阴干柜位 ----------
  function renderSlots(d) {
    $("#slots").innerHTML = R.SLOTS.map(slot => {
      const order = d.orders.find(o => o.status === "open" && o.slotId === slot);
      if (!order) {
        return `<div class="slot free"><div class="slot-id">${slot}</div><div class="meta">空闲</div></div>`;
      }
      const w = d.workById[order.workId];
      const b = d.batchById[order.batchId];
      const problems = R.batchProblems(b);
      return `<div class="slot ${problems.length ? "bad-slot" : "busy"}" onclick="Page.openOrderDesk('${order.id}')">
        <div class="slot-id">${slot} · ${esc(w ? w.theme : "?")}</div>
        <div class="meta">${esc(w ? w.base : "")} · ${esc(b ? b.name : "批次缺失")}${b ? "（" + esc(b.moisture) + "%）" : ""}</div>
        ${problems.length ? `<div class="reason">${esc(problems.join("；"))}</div>` : ""}
      </div>`;
    }).join("");
  }

  // ---------- 履历（作品日志 + 补灰单事件统一时间线） ----------
  function renderHistory(d) {
    const entries = [];
    d.works.forEach(w => (w.logs || []).forEach(line => {
      const at = line.slice(0, 24);
      entries.push({ at: at, text: line.replace(at, "").trim(), workId: w.id, theme: w.theme, kind: "作品" });
    }));
    d.orders.forEach(o => {
      const w = d.workById[o.workId];
      (o.events || []).forEach(line => {
        const at = line.slice(0, 24);
        entries.push({
          at: at,
          text: "[" + o.id.slice(0, 8) + "] " + line.replace(at, "").trim(),
          workId: o.workId,
          theme: w ? w.theme : "?",
          kind: "补灰"
        });
      });
    });
    entries.sort((a, b) => b.at.localeCompare(a.at));
    $("#history").innerHTML = entries.slice(0, 40).map(e =>
      `<div class="hist-row" onclick="Page.showDetail('${e.workId}')">
        <span class="badge ${e.kind === "补灰" ? "violet-badge" : ""}">${e.kind}</span>
        <span class="hist-time">${esc(fmt(e.at))}</span>
        <b>${esc(e.theme)}</b>
        <span class="meta">${esc(e.text)}</span>
      </div>`
    ).join("") || `<div class="empty">暂无履历</div>`;
  }

  function render() {
    const d = data();
    renderSummaries(d);
    renderBatches(d);
    renderBoard(d);
    renderSlots(d);
    renderHistory(d);
  }

  // ================= 作品操作 =================
  function updateStatus(id, status) {
    run(() => S.updateWorkStatus(id, status));
  }

  function recordDefect(id, text) {
    const value = text != null ? text : prompt("输入断线/翘线位置");
    if (!value) return;
    run(() => S.recordDefect(id, value.trim()));
  }

  function showDetail(id) {
    const d = data();
    const w = d.workById[id];
    if (!w) return;
    const order = d.openByWork[id];

    let orderSection;
    if (order) {
      orderSection = `<div class="dlg-order">
        <h3>未结束补灰单 ${esc(order.id.slice(0, 8))}</h3>
        <div class="meta">批次：${esc((d.batchById[order.batchId] || {}).name || "缺失")} ·
          柜位：${order.slotId ? esc(order.slotId) : "未占位"} ·
          批缝：${order.seamClosed ? "已闭合" : "未闭合"}</div>
        <div class="actions"><button class="violet" onclick="Page.openOrderDesk('${order.id}'); return false;">进入补灰单台</button></div>
      </div>`;
    } else {
      const opts = d.batches.map(b => {
        const problems = R.batchProblems(b);
        return `<option value="${b.id}" ${problems.length ? "disabled" : ""}>${esc(b.name)}（${esc(b.moisture)}%）${problems.length ? " — " + esc(problems.join("；")) : ""}</option>`;
      }).join("");
      orderSection = `<div class="dlg-order">
        <h3>批缝补灰</h3>
        <label>选择补灰批次
          <select id="newOrderBatch">${opts}<option value="" disabled selected>请选择</option></select>
        </label>
        <div class="actions"><button class="violet" onclick="Page.createOrderFromDialog('${w.id}')">开出补灰单</button></div>
        <div class="meta">每件作品仅允许一张未结束补灰单；停用或含水率 &gt; ${R.MOISTURE_LIMIT}% 的批次仅可开单、不得占柜位。</div>
      </div>`;
    }

    openDialog(`${w.theme} · ${w.base}`, `
      <div class="meta">
        线条粗细：${esc(w.line)} ｜ 贴线进度：${esc(w.progress)}%<br>
        阴干日期：${esc(w.dryDate)} ｜ 金粉状态：${esc(w.gold)}<br>
        交付日期：${esc(w.delivery)} ｜ 当前状态：${esc(w.status)}<br>
        缺陷位置：${esc(w.defect || "无")} ｜ 备注：${esc(w.note || "无")}
      </div>

      <div class="dlg-section">
        <h3>胎体 / 纹样修正（准入结果按新值重算）</h3>
        <div class="grid2">
          <label>胎体材质<input id="correctBase" value="${esc(w.base)}"></label>
          <label>纹样主题<input id="correctTheme" value="${esc(w.theme)}"></label>
        </div>
        <div class="actions">
          <button class="warn" onclick="Page.correctDesign('${w.id}','base')">保存胎体</button>
          <button class="warn" onclick="Page.correctDesign('${w.id}','theme')">保存纹样</button>
        </div>
      </div>

      <div class="dlg-section">
        <label>记录缺陷<input id="defectInput" placeholder="断线/翘线位置"></label>
        <div class="actions"><button class="warn" onclick="Page.saveDefectFromDialog('${w.id}')">保存缺陷</button></div>
      </div>

      <div class="dlg-section">
        <h3>工序状态</h3>
        <div class="actions">
          ${statuses.map(s => `<button class="${s === w.status ? "secondary" : ""}" onclick="Page.updateStatus('${w.id}','${s}')">${s}</button>`).join("")}
        </div>
      </div>

      <div class="dlg-section">${orderSection}</div>

      <div class="dlg-section">
        <h3>流转与补灰履历</h3>
        <div class="logbox">${renderWorkTimeline(d, w)}</div>
      </div>
      <div class="actions"><button class="secondary" onclick="Page.closeDialog()">关闭</button></div>
    `);
  }

  function renderWorkTimeline(d, w) {
    const rows = [];
    (w.logs || []).forEach(l => {
      const at = l.slice(0, 24);
      rows.push({ at: at, html: `<div class="hist-line"><span class="hist-time">${esc(fmt(at))}</span>${esc(l.replace(at, "").trim())}</div>` });
    });
    d.orders.filter(o => o.workId === w.id).forEach(o => {
      (o.events || []).forEach(l => {
        const at = l.slice(0, 24);
        rows.push({ at: at, html: `<div class="hist-line"><span class="hist-time">${esc(fmt(at))}</span><span class="badge violet-badge">补灰</span> ${esc(l.replace(at, "").trim())}</div>` });
      });
    });
    rows.sort((a, b) => b.at.localeCompare(a.at));
    return rows.map(r => r.html).join("");
  }

  function saveDefectFromDialog(id) {
    const input = $("#defectInput");
    const value = input.value.trim();
    if (!value) return;
    run(() => S.recordDefect(id, value));
    showDetail(id);
  }

  function correctDesign(id, field) {
    const value = $(field === "base" ? "#correctBase" : "#correctTheme").value.trim();
    if (!value) return alert("内容不能为空");
    run(() => S.correctDesign(id, field, value));
    showDetail(id);
  }

  function createOrderFromDialog(workId) {
    const sel = $("#newOrderBatch");
    if (!sel.value) return alert("请选择补灰批次");
    let order;
    run(() => { order = S.createOrder(workId, sel.value); });
    if (order) openOrderDesk(order.id);
  }

  function createOrderPrompt(workId) {
    showDetail(workId);
  }

  // ================= 补灰批次操作 =================
  function toggleBatch(id) {
    const d = data();
    const b = d.batchById[id];
    run(() => S.updateBatch(id, { active: !b.active }));
  }

  function setBatchMoisture(id, value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) return alert("含水率无效");
    run(() => S.updateBatch(id, { moisture: num }));
  }

  // ================= 补灰单台 =================
  function openOrderDesk(orderId) {
    const d = data();
    const order = d.orders.find(o => o.id === orderId);
    if (!order || order.status !== "open") return;
    const w = d.workById[order.workId];
    const batch = d.batchById[order.batchId];
    const problems = R.batchProblems(batch);
    const stats = R.weighingStats(order);
    const live = R.evaluate(order, w, batch);
    const cachedCurrent = evalIsCurrent(order, w, batch);

    const freeSlots = R.SLOTS.filter(s => !d.orders.some(o => o.status === "open" && o.slotId === s && o.id !== order.id));
    const slotButtons = freeSlots.map(s =>
      `<button class="${order.slotId === s ? "secondary" : ""}" onclick="Page.occupySlot('${order.id}','${s}')">${s}</button>`
    ).join("") || `<span class="meta">无空闲柜位</span>`;

    const statRows = stats.map(s =>
      `<tr><td>${s.label}</td><td>${esc(fmt(s.at))}</td><td>${esc(s.person)}</td><td>${esc(s.weight)}g</td>
        <td class="${s.inBand ? "ok-text" : "bad-text"}">${s.ratioText}</td></tr>`
    ).join("");

    const canWeigh = (order.weighings || []).length < R.REQUIRED_WEIGHINGS && Number(order.repairWeight) > 0;
    const lastWeighing = (order.weighings || []).slice(-1)[0];
    const suggestBase = lastWeighing ? new Date(lastWeighing.at)
      : (order.repairedAt ? new Date(order.repairedAt) : new Date());
    const suggestedAt = dtLocal(new Date(suggestBase.getTime() + 25 * 3600000));

    openDialog(`补灰单台 · ${w.theme}`, `
      <div class="meta">
        作品：<b>${esc(w.theme)}</b>（${esc(w.base)}）｜补灰批次：<b>${esc(batch ? batch.name : "缺失")}</b>，
        含水率 ${batch ? esc(batch.moisture) + "%" : "—"}，${batch && batch.active ? "启用中" : "已停用"}
      </div>
      ${problems.length ? `<div class="reason">批次限制：${esc(problems.join("；"))}</div>` : ""}

      <div class="dlg-section">
        <h3>① 阴干柜位</h3>
        <div class="meta">当前：${order.slotId ? "<b>" + esc(order.slotId) + "</b>" : "未占位（批次停用或含水率 &gt; " + R.MOISTURE_LIMIT + "% 时不得占位）"}</div>
        <div class="actions">${slotButtons}</div>
        ${order.slotId ? `<div class="actions"><button class="warn" onclick="Page.releaseSlot('${order.id}')">释放柜位</button></div>` : ""}
      </div>

      <div class="dlg-section">
        <h3>② 修补登记</h3>
        <div class="grid2">
          <label>修补人<input id="repairer" value="${esc(order.repairer)}" placeholder="陈师傅"></label>
          <label>修补初重（g）<input id="repairWeight" type="number" step="0.01" min="0" value="${order.repairWeight ?? ""}"></label>
        </div>
        <label>修补完成时间<input id="repairedAt" type="datetime-local" value="${order.repairedAt ? dtLocal(new Date(order.repairedAt)) : dtLocal()}"></label>
        <div class="actions"><button class="secondary" onclick="Page.saveRepair('${order.id}')">登记/重登记修补</button></div>
        <div class="meta">重登记后旧称重清空；称重人须与修补人换人。</div>
      </div>

      <div class="dlg-section">
        <h3>③ 隔 24 小时两次称重（失重比例须均在 0.20%~0.60%）</h3>
        ${statRows ? `<table class="weigh-table"><tr><th>轮次</th><th>时间</th><th>称重人</th><th>重量</th><th>失重</th></tr>${statRows}</table>` : `<div class="meta">暂无称重记录</div>`}
        ${canWeigh ? `
          <div class="grid2">
            <label>称重时间<input id="weighAt" type="datetime-local" value="${suggestedAt}"></label>
            <label>称重人（须换人）<input id="weighPerson" placeholder="林师傅"></label>
          </div>
          <label>本次重量（g）<input id="weighWeight" type="number" step="0.01" min="0" placeholder="119.52"></label>
          <div class="actions"><button class="violet" onclick="Page.addWeighing('${order.id}')">提交第${(order.weighings || []).length + 1}次称重</button></div>
          <div class="meta">两次称重间隔须满 24 小时；区间外仍可记录，但判定不会通过。</div>
        ` : (Number(order.repairWeight) > 0 ? `<div class="meta">两次称重已完成。</div>` : `<div class="reason">请先登记修补信息。</div>`)}
      </div>

      <div class="dlg-section">
        <h3>④ 批缝闭合</h3>
        <div class="actions">
          <button class="${order.seamClosed ? "secondary" : "warn"}" onclick="Page.toggleSeam('${order.id}', ${!order.seamClosed})">
            ${order.seamClosed ? "标记为未闭合" : "确认批缝已闭合"}
          </button>
        </div>
      </div>

      <div class="dlg-section judge-box">
        <h3>⑤ 复阴准入判定</h3>
        <div class="meta">实时自检：${live.verdict === "pass"
          ? "<span class='ok-text'>条件满足，可发起判定</span>"
          : "未满足 — " + esc(live.problems.join("；"))}</div>
        <div class="meta">首次判定结果：${order.eval
          ? (cachedCurrent
            ? (order.eval.verdict === "pass" ? "<span class='ok-text'>通过</span>" : "<span class='bad-text'>未通过：" + esc(order.eval.problems.join("；")) + "</span>")
            : "<span class='bad-text'>输入已变化，旧结果失效，需按新值重算</span>")
          : "尚未判定"}</div>
        <div class="actions">
          <button class="violet" onclick="Page.judge('${order.id}', this)">发起准入判定</button>
          <button id="admitBtn" ${cachedCurrent && order.eval && order.eval.verdict === "pass" ? "" : "disabled"}
                  onclick="Page.admit('${order.id}')">准入金粉并释放柜位</button>
          <button class="danger" onclick="Page.closeOrder('${order.id}')">结束/作废补灰单</button>
        </div>
      </div>

      <div class="dlg-section">
        <h3>补灰单履历</h3>
        <div class="logbox">${(order.events || []).slice().reverse().map(l => {
          const at = l.slice(0, 24);
          return `<div class="hist-line"><span class="hist-time">${esc(fmt(at))}</span>${esc(l.replace(at, "").trim())}</div>`;
        }).join("")}</div>
      </div>
      <div class="actions"><button class="secondary" onclick="Page.closeDialog()">关闭</button></div>
    `);
  }

  function occupySlot(orderId, slotId) {
    run(() => S.occupySlot(orderId, slotId));
    openOrderDesk(orderId);
  }

  function releaseSlot(orderId) {
    run(() => S.releaseSlot(orderId, "手动释放"));
    openOrderDesk(orderId);
  }

  function saveRepair(orderId) {
    run(() => S.setRepair(orderId, {
      repairer: $("#repairer").value,
      repairWeight: $("#repairWeight").value,
      repairedAt: $("#repairedAt").value
    }));
    openOrderDesk(orderId);
  }

  function addWeighing(orderId) {
    run(() => S.addWeighing(orderId, {
      at: $("#weighAt").value,
      person: $("#weighPerson").value,
      weight: $("#weighWeight").value
    }));
    openOrderDesk(orderId);
  }

  function toggleSeam(orderId, closed) {
    run(() => S.setSeam(orderId, closed));
    openOrderDesk(orderId);
  }

  function judge(orderId, btn) {
    return runAsync(async () => {
      const r = await S.judge(orderId);
      if (r.result.verdict === "pass") {
        alert("复阴准入判定通过：可准入金粉。");
      } else {
        alert("准入未通过，继续占位：\n" + r.result.problems.join("\n"));
      }
      openOrderDesk(orderId);
    }, btn);
  }

  function admit(orderId) {
    let order;
    run(() => { order = S.admit(orderId); });
    if (order) {
      alert("已准入金粉，补灰单结束，柜位已释放。");
      closeDialog();
    }
  }

  function closeOrder(orderId) {
    if (!confirm("确认结束（作废）这张补灰单？柜位将被释放。")) return;
    run(() => S.closeOrder(orderId, "手动作废"));
    closeDialog();
  }

  // ================= 弹窗 =================
  const dialog = $("#appDialog");
  function openDialog(title, html) {
    $("#dialogTitle").textContent = title;
    $("#dialogBody").innerHTML = html;
    if (!dialog.open) dialog.showModal();
  }
  function closeDialog() { dialog.close(); }

  // ================= 初始化 =================
  const workForm = $("#workForm");
  workForm.dryDate.value = today;
  workForm.delivery.value = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  $("#statusFilter").innerHTML = `<option value="">全部状态</option>` +
    statuses.map(s => `<option>${s}</option>`).join("");

  workForm.addEventListener("submit", event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(workForm).entries());
    run(() => S.addWork(data));
    workForm.reset();
    workForm.dryDate.value = today;
    workForm.delivery.value = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  });

  $("#batchForm").addEventListener("submit", event => {
    event.preventDefault();
    const f = event.currentTarget;
    run(() => S.addBatch({
      name: f.batchName.value.trim(),
      moisture: f.moisture.value,
      note: f.note.value.trim()
    }));
    f.reset();
    f.moisture.value = "9";
  });

  $("#clearFilters").addEventListener("click", () => {
    $("#themeFilter").value = "";
    $("#statusFilter").value = "";
    render();
  });
  ["#statusFilter", "#themeFilter", "#sortMode"].forEach(sel => {
    $(sel).addEventListener("input", render);
  });

  $("#exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(S.snapshot(), null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "putty-admission-state.json";
    link.click();
    URL.revokeObjectURL(link.href);
  });

  $("#resetBtn").addEventListener("click", () => {
    if (!confirm("将清空本地数据并恢复演示数据，确认？")) return;
    S.reset();
    render();
  });

  // 其他标签页改动后同步，保证看板/柜位/履历一致
  window.addEventListener("storage", () => {
    S.reconcileSlots();
    render();
  });

  window.Page = {
    updateStatus, recordDefect, showDetail, saveDefectFromDialog, correctDesign,
    createOrderFromDialog, createOrderPrompt,
    toggleBatch, setBatchMoisture,
    openOrderDesk, occupySlot, releaseSlot, saveRepair, addWeighing,
    toggleSeam, judge, admit, closeOrder, closeDialog
  };

  render();
})();
