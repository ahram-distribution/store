import{g}from"./index-D1BPpYER.js";function x(){return`
    @page { size: A4; margin: 18mm 15mm }
    * { box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
      font-size: 11px;
      color: #1e293b;
      margin: 0;
      padding: 0;
      line-height: 1.5;
    }

    /* ── Header ── */
    .report-header {
      text-align: center;
      border-bottom: 3px solid #2563eb;
      padding-bottom: 14px;
      margin-bottom: 20px;
    }
    .report-header h1 {
      font-size: 20px;
      color: #1e293b;
      margin: 0 0 2px;
      font-weight: 800;
      letter-spacing: 0.3px;
    }
    .report-header .role-line {
      font-size: 12px;
      color: #475569;
      margin: 4px 0 0;
      font-weight: 600;
    }
    .report-header .owner-name {
      font-size: 14px;
      color: #2563eb;
      margin: 6px 0 0;
      font-weight: 700;
    }
    .report-header .manager-line {
      font-size: 11px;
      color: #64748b;
      margin: 3px 0 0;
    }
    .report-header .period-line {
      font-size: 11px;
      color: #475569;
      margin: 10px 0 2px;
      padding: 5px 14px;
      background: #f1f5f9;
      border-radius: 6px;
      display: inline-block;
    }
    .report-header .meta-line {
      font-size: 9.5px;
      color: #94a3b8;
      margin: 6px 0 0;
    }
    .report-header .meta-line span {
      margin: 0 6px;
    }

    /* ── Sections ── */
    .section {
      margin-bottom: 18px;
      page-break-inside: avoid;
    }
    .section h2 {
      font-size: 13px;
      color: #2563eb;
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 5px;
      margin: 0 0 10px;
      font-weight: 700;
    }
    .section .subtitle {
      font-size: 10px;
      color: #64748b;
      margin: 0 0 8px;
    }

    /* ── Tables ── */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10.5px;
      margin-bottom: 10px;
    }
    thead tr {
      background: #f1f5f9;
    }
    th {
      text-align: right;
      padding: 7px 10px;
      font-weight: 700;
      color: #475569;
      border-bottom: 2px solid #cbd5e1;
      font-size: 10px;
      text-transform: none;
    }
    td {
      padding: 6px 10px;
      border-bottom: 1px solid #f1f5f9;
    }
    tbody tr:nth-child(even) {
      background: #f8fafc;
    }
    tbody tr:hover {
      background: #f1f5f9;
    }

    /* ── KPI Grid ── */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      margin-bottom: 12px;
    }
    .kpi-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 10px 12px;
      text-align: center;
    }
    .kpi-card .value {
      font-size: 16px;
      font-weight: 800;
      color: #1e293b;
    }
    .kpi-card .label {
      font-size: 10px;
      color: #64748b;
      margin-top: 2px;
      font-weight: 500;
    }
    .kpi-card.color-emerald { border-left: 3px solid #10b981; }
    .kpi-card.color-blue { border-left: 3px solid #3b82f6; }
    .kpi-card.color-amber { border-left: 3px solid #f59e0b; }
    .kpi-card.color-violet { border-left: 3px solid #8b5cf6; }
    .kpi-card.color-success .value { color: #16a34a; }
    .kpi-card.color-primary .value { color: #2563eb; }
    .kpi-card.color-warning .value { color: #ca8a04; }
    .kpi-card.color-accent .value { color: #7c3aed; }

    /* ── Badges ── */
    .status-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 600;
    }
    .status-green { background: #dcfce7; color: #166534; }
    .status-yellow { background: #fef9c3; color: #854d0e; }
    .status-red { background: #fee2e2; color: #991b1b; }
    .text-green { color: #16a34a; }
    .text-yellow { color: #ca8a04; }
    .text-red { color: #dc2626; }
    .text-muted { color: #64748b; }

    /* ── Footer ── */
    .footer {
      text-align: center;
      font-size: 9px;
      color: #94a3b8;
      margin-top: 24px;
      padding-top: 10px;
      border-top: 1px solid #e2e8f0;
    }
  `}function p(r){try{const n=new Date(r),[o,e,t]=g(n);return`${t} ${["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"][e-1]} ${o}`}catch{return r.slice(0,10)}}function h({title:r,subtitle:n,identity:o,dateFrom:e,dateTo:t,sections:l}){const i=window.open("","_blank");if(!i)return;const c=new Date,d=c.toLocaleDateString("ar-EG-u-nu-latn",{weekday:"long",year:"numeric",month:"long",day:"numeric"}),b=c.toLocaleTimeString("ar-EG-u-nu-latn",{hour:"2-digit",minute:"2-digit",hour12:!0}),s=e&&t?`الفترة: ${p(e)} — ${p(t)}`:"",m=(()=>{const a=[];return o!=null&&o.roleLabel&&a.push(`<div class="role-line">${o.roleLabel}</div>`),o!=null&&o.ownerName&&a.push(`<div class="owner-name">${o.ownerName}</div>`),o!=null&&o.managerName&&a.push(`<div class="manager-line">يتبع: ${o.managerName}</div>`),a.join(`
`)})(),f=l.map(a=>`
    <div class="section">
      <h2>${a.title}</h2>
      ${a.subtitle?`<p class="subtitle">${a.subtitle}</p>`:""}
      ${a.content}
    </div>
  `).join("");i.document.write(`<!DOCTYPE html>
<html dir="rtl">
<head>
  <meta charset="utf-8">
  <title>${r}</title>
  <style>${x()}</style>
</head>
<body>
  <div class="report-header">
    <h1>${n||r}</h1>
    ${m}
    ${s?`<div class="period-line">${s}</div>`:""}
    <div class="meta-line">
      <span>تاريخ الطباعة: ${d}</span>
      <span>|</span>
      <span>الوقت: ${b}</span>
    </div>
  </div>
  ${f}
  <div class="footer">تم التصدير بواسطة نظام الأهرام للتوزيع المتكامل — ${d}</div>
</body>
</html>`),i.document.close(),i.focus(),setTimeout(()=>i.print(),500)}function v(r,n){const o=r.map(t=>`<th>${t}</th>`).join(""),e=n.map(t=>`<tr>${t.map(l=>`<td>${l??"—"}</td>`).join("")}</tr>`).join("");return`<table><thead><tr>${o}</tr></thead><tbody>${e}</tbody></table>`}function $(r){const n={emerald:"color-emerald color-success",blue:"color-blue color-primary",amber:"color-amber color-warning",violet:"color-violet color-accent"};return`<div class="kpi-grid">${r.map(e=>`<div class="kpi-card ${e.color&&n[e.color]||""}"><div class="value">${e.value}</div><div class="label">${e.label}</div></div>`).join("")}</div>`}export{h as e,$ as k,v as t};
