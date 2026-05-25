export function renderPage(opts: {
  projectPath: string;
  strategy: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Karta — ${escapeHtml(opts.projectPath)}</title>
  <style>
    html, body { margin: 0; padding: 0; height: 100%; background: #0b0d12; color: #e6e9ef; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow: hidden; }
    #graph { width: 100vw; height: 100vh; }
    #panel {
      position: fixed; top: 12px; left: 12px; max-width: 340px;
      background: rgba(15, 18, 26, 0.92); border: 1px solid #232836;
      padding: 14px 16px; border-radius: 8px; font-size: 12px; line-height: 1.5;
      max-height: 92vh; overflow-y: auto; backdrop-filter: blur(6px);
    }
    #panel h1 { font-size: 13px; margin: 0 0 6px; color: #fff; letter-spacing: 0.5px; }
    #panel .row { color: #9aa3b2; }
    #panel .row b { color: #e6e9ef; font-weight: 600; }
    #legend { margin-top: 10px; padding-top: 10px; border-top: 1px solid #232836; }
    #legend .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 50%; vertical-align: middle; margin-right: 6px; }
    #detail {
      position: fixed; top: 12px; right: 12px; width: 340px;
      background: rgba(15, 18, 26, 0.92); border: 1px solid #232836;
      padding: 14px 16px; border-radius: 8px; font-size: 12px; line-height: 1.5;
      max-height: 92vh; overflow-y: auto; backdrop-filter: blur(6px);
      display: none;
    }
    #detail h2 { font-size: 13px; margin: 0 0 6px; color: #fff; }
    #detail pre { white-space: pre-wrap; word-break: break-word; color: #c9d1de; font-size: 11px; margin: 6px 0; }
    #detail .k { color: #8aa6ff; }
    .close { float: right; cursor: pointer; color: #9aa3b2; }
    .close:hover { color: #fff; }
    .err { color: #ff8a8a; }
    a { color: #8aa6ff; }
  </style>
</head>
<body>
  <div id="graph"></div>
  <div id="panel">
    <h1>karta</h1>
    <div class="row">project: <b>${escapeHtml(opts.projectPath)}</b></div>
    <div class="row">strategy: <b id="strategy">${escapeHtml(opts.strategy)}</b></div>
    <div class="row" id="summary"></div>
    <div id="legend"></div>
    <div class="row" style="margin-top:10px; color:#6f7787;">click a node for details · scroll to zoom · drag to rotate</div>
  </div>
  <div id="detail"></div>

  <script src="//unpkg.com/3d-force-graph@1.73.4/dist/3d-force-graph.min.js"></script>
  <script>
    const PALETTE = {
      shared:  '#5eead4',
      leaf:    '#fbbf24',
      hub:     '#f472b6',
      entry:   '#a78bfa',
      page:    '#60a5fa',
      client:  '#fb923c',
      layout:  '#34d399',
      api:     '#f87171',
      loading: '#94a3b8',
      error:   '#ef4444',
    };
    function colorFor(group) { return PALETTE[group] || '#9aa3b2'; }

    const summaryEl = document.getElementById('summary');
    const legendEl = document.getElementById('legend');
    const detailEl = document.getElementById('detail');

    function renderSummary(summary) {
      const parts = Object.entries(summary).map(([k, v]) => {
        if (Array.isArray(v)) return \`<div>\${k}: <b>\${v.length === 0 ? 'none' : v.join(', ')}</b></div>\`;
        return \`<div>\${k}: <b>\${v}</b></div>\`;
      });
      summaryEl.innerHTML = parts.join('');
    }

    function renderLegend(legend) {
      legendEl.innerHTML = legend.map(l =>
        \`<div><span class="swatch" style="background:\${colorFor(l.group)}"></span>\${l.group} — <span style="color:#9aa3b2">\${l.description}</span></div>\`
      ).join('');
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    function showDetail(node) {
      const meta = node.meta || {};
      const rows = Object.entries(meta).map(([k, v]) => {
        const val = Array.isArray(v) ? (v.length ? v.map(escapeHtml).join('\\n  - ') : '(none)') : escapeHtml(String(v));
        return \`<div><span class="k">\${escapeHtml(k)}:</span>\${Array.isArray(v) && v.length ? '\\n  - ' + val : ' ' + val}</div>\`;
      }).join('');
      detailEl.innerHTML = \`
        <span class="close" onclick="document.getElementById('detail').style.display='none'">×</span>
        <h2>\${escapeHtml(node.label)}</h2>
        <pre>\${rows}</pre>
      \`;
      detailEl.style.display = 'block';
    }

    fetch('/api/graph')
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          document.getElementById('graph').innerHTML =
            '<div style="padding:40px;color:#ff8a8a">Error: ' + escapeHtml(data.error) + '</div>';
          return;
        }
        document.getElementById('strategy').textContent = data.strategy;
        renderSummary(data.summary || {});
        renderLegend(data.legend || []);

        const Graph = ForceGraph3D()(document.getElementById('graph'))
          .backgroundColor('#0b0d12')
          .graphData({ nodes: data.nodes, links: data.links })
          .nodeId('id')
          .nodeLabel(n => n.label)
          .nodeVal(n => n.size || 4)
          .nodeColor(n => colorFor(n.group))
          .linkColor(() => 'rgba(160,170,190,0.35)')
          .linkDirectionalArrowLength(3)
          .linkDirectionalArrowRelPos(0.95)
          .linkOpacity(0.6)
          .linkWidth(1)
          .onNodeClick(node => {
            showDetail(node);
            // Aim camera at clicked node
            const distance = 80;
            const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z || 1);
            Graph.cameraPosition(
              { x: node.x * distRatio, y: node.y * distRatio, z: (node.z || 0) * distRatio },
              node,
              1200
            );
          });
      })
      .catch(err => {
        document.getElementById('graph').innerHTML =
          '<div style="padding:40px;color:#ff8a8a">Failed to load graph: ' + escapeHtml(err.message) + '</div>';
      });
  </script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c]
  );
}
