const API_CONFIG = {
  USE_MOCK: true,
  BASE_URL: "http://localhost:8080",
  ENDPOINTS: {
    HEALTH: "/health",
    ORDERS: "/transacciones",
    AUDIT: "/auditoria"
  }
};

// Estado inicial simulado de la infraestructura (según arquitectura U3)
const initialNodes = [
  {
    group: "Balanceadores de Carga (HAProxy)",
    tag: "Round Robin + Health Checks",
    nodes: [
      { id: "HAProxy-Principal", tech: "Reverse Proxy", port: "8080 -> 80", role: "Activo", status: "online" },
      { id: "HAProxy-Interno", tech: "Enrutador Interno", port: "Red Docker", role: "Activo", status: "online" }
    ]
  },
  {
    group: "Módulo A — API Gateway / Ingesta",
    tag: "Node.js / TypeScript",
    nodes: [
      { id: "Gateway-A1", tech: "TypeScript", port: "8080", role: "Stateless", status: "online" },
      { id: "Gateway-A2", tech: "TypeScript", port: "8080", role: "Stateless", status: "online" },
      { id: "Gateway-A3", tech: "TypeScript", port: "8080", role: "Stateless", status: "online" }
    ]
  },
  {
    group: "Módulo B — Procesamiento de Negocio",
    tag: "Python / FastAPI",
    nodes: [
      { id: "Dominio-B1", tech: "FastAPI", port: "5000", role: "Stateless", status: "online" },
      { id: "Dominio-B2", tech: "FastAPI", port: "5000", role: "Stateless", status: "online" },
      { id: "Dominio-B3", tech: "FastAPI", port: "5000", role: "Stateless", status: "online" }
    ]
  },
  {
    group: "Módulo C — Servicio de Auditoría",
    tag: "Go / Gin-Fiber",
    nodes: [
      { id: "Auditoria-C1", tech: "Go", port: "6000", role: "Stateless", status: "online" },
      { id: "Auditoria-C2", tech: "Go", port: "6000", role: "Stateless", status: "online" },
      { id: "Auditoria-C3", tech: "Go", port: "6000", role: "Stateless", status: "online" }
    ]
  },
  {
    group: "Persistencia — PostgreSQL 17 & MongoDB 7",
    tag: "Replicación + Failover Automático",
    nodes: [
      { id: "PG-Node-1", tech: "PostgreSQL 17", port: "5432", role: "Primary", status: "online" },
      { id: "PG-Node-2", tech: "PostgreSQL 17", port: "5432", role: "Replica", status: "online" },
      { id: "PG-Node-3", tech: "PostgreSQL 17", port: "5432", role: "Replica", status: "online" },
      { id: "Mongo-Node-1", tech: "MongoDB 7", port: "27017", role: "Primary", status: "online" },
      { id: "Mongo-Node-2", tech: "MongoDB 7", port: "27017", role: "Secondary", status: "online" },
      { id: "Mongo-Node-3", tech: "MongoDB 7", port: "27017", role: "Secondary", status: "online" }
    ]
  }
];

let infraState = structuredClone(initialNodes);

let orders = [
  { id: "TX-1041", cliente: "Distribuidora Curicó", repartidor: "Carlos Muñoz", monto: 48500, nodo: "Dominio-B1", estado: "Entregado" },
  { id: "TX-1042", cliente: "Ferretería El Roble", repartidor: "Valentina Soto", monto: 129900, nodo: "Dominio-B2", estado: "En camino" },
  { id: "TX-1043", cliente: "Café Central Talca", repartidor: "Matías Paredes", monto: 34200, nodo: "Dominio-B3", estado: "Pendiente" }
];

let auditLogs = [
  { time: "14:52:10", type: "TX", source: "Auditoria-C1", detail: "Pedido TX-1041 confirmado y persistido en PG-Node-1", result: "OK" },
  { time: "14:55:03", type: "TX", source: "Auditoria-C2", detail: "Asignación de repartidor Valentina Soto a TX-1042", result: "OK" },
  { time: "15:01:44", type: "FAILOVER", source: "HAProxy-Principal", detail: "Health check completado: 100% de instancias saludables", result: "OK" }
];

let rrCounter = 0; // Simula Round Robin para asignar qué nodo procesa nuevos pedidos

// --- Navegación entre pestañas ---
const titles = {
  monitoreo: ["Monitoreo de Infraestructura", "Estado en tiempo real de balanceadores, microservicios y réplicas de BD"],
  pedidos: ["Pedidos y Transacciones", "Operaciones de negocio coordinadas por Gateway (TS) y Dominio (Python)"],
  auditoria: ["Auditoría y Eventos", "Trazabilidad de operaciones y eventos de failover almacenados en MongoDB"]
};

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-view").forEach(v => v.classList.remove("active"));

    btn.classList.add("active");
    const target = btn.dataset.tab;
    document.getElementById(`tab-${target}`).classList.add("active");
    document.getElementById("view-title").textContent = titles[target][0];
    document.getElementById("view-subtitle").textContent = titles[target][1];
  });
});

// --- Renderizado de Infraestructura ---
function renderInfra() {
  const container = document.getElementById("infra-container");
  container.innerHTML = "";

  let total = 0;
  let active = 0;

  infraState.forEach(group => {
    const section = document.createElement("div");
    section.className = "infra-group";

    const cardsHtml = group.nodes.map(node => {
      total++;
      if (node.status === "online") active++;

      const isDown = node.status === "down";
      const roleClass = node.role === "Primary" ? "primary" : (node.role === "Replica" || node.role === "Secondary" ? "replica" : "online");
      const statusBadge = isDown
        ? `<span class="status-badge down">CAÍDO</span>`
        : `<span class="status-badge ${roleClass}">${node.role}</span>`;

      return `
        <div class="node-card ${isDown ? "down" : ""}">
          <div class="node-top">
            <span class="node-name">${node.id}</span>
            ${statusBadge}
          </div>
          <div class="node-meta">
            <span>${node.tech}</span>
            <span>Puerto: ${node.port}</span>
          </div>
        </div>
      `;
    }).join("");

    section.innerHTML = `
      <div class="infra-group-header">
        <h3>${group.group}</h3>
        <span class="infra-tag">${group.tag}</span>
      </div>
      <div class="node-grid">${cardsHtml}</div>
    `;
    container.appendChild(section);
  });

  document.getElementById("health-summary").innerHTML = `Nodos activos: <strong>${active} / ${total}</strong>`;
}

// --- Renderizado de Pedidos ---
function renderOrders(filterText = "") {
  const tbody = document.getElementById("orders-tbody");
  const q = filterText.toLowerCase();

  const filtered = orders.filter(o =>
    o.id.toLowerCase().includes(q) ||
    o.cliente.toLowerCase().includes(q) ||
    o.repartidor.toLowerCase().includes(q)
  );

  tbody.innerHTML = filtered.map(o => {
    const badgeClass = o.estado === "Entregado" ? "online" : (o.estado === "En camino" ? "primary" : "warning");
    return `
      <tr>
        <td><strong>${o.id}</strong></td>
        <td>${o.cliente}</td>
        <td>${o.repartidor}</td>
        <td>$${o.monto.toLocaleString("es-CL")}</td>
        <td><code>${o.nodo}</code></td>
        <td><span class="status-badge ${badgeClass}">${o.estado}</span></td>
      </tr>
    `;
  }).join("");
}

// --- Renderizado de Auditoría ---
function renderAudit() {
  const tbody = document.getElementById("audit-tbody");
  const typeFilter = document.getElementById("audit-filter-type").value;
  const searchText = document.getElementById("audit-search").value.toLowerCase();

  const filtered = auditLogs.filter(log => {
    const matchesType = typeFilter === "ALL" || log.type === typeFilter;
    const matchesText = log.detail.toLowerCase().includes(searchText) || log.source.toLowerCase().includes(searchText);
    return matchesType && matchesText;
  });

  tbody.innerHTML = filtered.map(log => {
    const resClass = log.result === "OK" ? "online" : "warning";
    return `
      <tr>
        <td>${log.time}</td>
        <td><span class="status-badge primary">${log.type}</span></td>
        <td><strong>${log.source}</strong></td>
        <td>${log.detail}</td>
        <td><span class="status-badge ${resClass}">${log.result}</span></td>
      </tr>
    `;
  }).join("");
}

// --- Utilidades de Demo ---
function getNowTime() {
  return new Date().toLocaleTimeString("es-CL", { hour12: false });
}

function showAlert(message, type = "info") {
  const banner = document.getElementById("alert-banner");
  banner.textContent = message;
  banner.className = `alert-banner ${type}`;
}

function addAuditLog(type, source, detail, result = "OK") {
  auditLogs.unshift({ time: getNowTime(), type, source, detail, result });
  renderAudit();
}

// --- Eventos de Simulación de Failover ---
document.getElementById("btn-fail-app").addEventListener("click", () => {
  const modA = infraState[1].nodes;
  const modB = infraState[2].nodes;

  modA[0].status = "down";
  modB[1].status = "down";

  showAlert(
    "Fallo detectado: Gateway-A1 y Dominio-B2 dejaron de responder. HAProxy los excluyó del pool y redirige el tráfico por Round Robin hacia las instancias activas sin interrupción.",
    "danger"
  );
  addAuditLog("FAILOVER", "HAProxy-Interno", "Exclusión automática de Gateway-A1 y Dominio-B2 tras Health Check fallido", "MITIGADO");
  renderInfra();
});

document.getElementById("btn-fail-pg").addEventListener("click", () => {
  const dbNodes = infraState[4].nodes;
  const pg1 = dbNodes.find(n => n.id === "PG-Node-1");
  const pg2 = dbNodes.find(n => n.id === "PG-Node-2");

  if (pg1.status === "online") {
    pg1.status = "down";
    pg1.role = "Offline";
    pg2.role = "Primary";
    document.getElementById("kpi-pg-primary").textContent = "PG-Node-2";
    showAlert(
      "Failover automático ejecutado: PG-Node-1 cayó. Patroni + etcd promovieron a PG-Node-2 como nuevo Primary y el proxy SQL redirigió las escrituras.",
      "warning"
    );
    addAuditLog("FAILOVER", "Patroni / etcd", "Promoción automática de PG-Node-2 a Primary tras caída de PG-Node-1", "RECUPERADO");
    renderInfra();
  }
});

document.getElementById("btn-restore").addEventListener("click", () => {
  infraState = structuredClone(initialNodes);
  document.getElementById("kpi-pg-primary").textContent = "PG-Node-1";
  document.getElementById("alert-banner").className = "alert-banner hidden";
  addAuditLog("FAILOVER", "Docker / HAProxy", "Clúster restaurado: todas las instancias y réplicas operativas", "OK");
  renderInfra();
});

// --- Crear Pedido (Simula flujo completo A -> B -> C) ---
document.getElementById("order-form").addEventListener("submit", (e) => {
  e.preventDefault();

  const activeB = infraState[2].nodes.filter(n => n.status === "online");
  const activeC = infraState[3].nodes.filter(n => n.status === "online");
  const chosenB = activeB[rrCounter % activeB.length]?.id || "Dominio-B1";
  const chosenC = activeC[rrCounter % activeC.length]?.id || "Auditoria-C1";
  rrCounter++;

  const newOrder = {
    id: `TX-${1041 + orders.length}`,
    cliente: document.getElementById("cliente").value.trim(),
    repartidor: document.getElementById("repartidor").value,
    monto: Number(document.getElementById("monto").value),
    nodo: chosenB,
    estado: "Pendiente"
  };

  orders.unshift(newOrder);
  renderOrders();
  addAuditLog("TX", chosenC, `Transacción ${newOrder.id} (${newOrder.cliente}) procesada por ${chosenB}`, "OK");

  e.target.reset();
});

// --- Filtros en tiempo real ---
document.getElementById("order-search").addEventListener("input", (e) => renderOrders(e.target.value));
document.getElementById("audit-filter-type").addEventListener("change", renderAudit);
document.getElementById("audit-search").addEventListener("input", renderAudit);

// Inicializar vistas
renderInfra();
renderOrders();
renderAudit();