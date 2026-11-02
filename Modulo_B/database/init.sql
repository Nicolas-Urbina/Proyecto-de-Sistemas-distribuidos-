CREATE TABLE IF NOT EXISTS transacciones (
    transaccion_id UUID PRIMARY KEY,
    estado TEXT NOT NULL,
    marca_de_tiempo TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS pedidos (
    pedido_id TEXT PRIMARY KEY,
    cliente TEXT NOT NULL,
    direccion TEXT NOT NULL,
    descripcion TEXT NOT NULL,
    repartidor TEXT,
    estado TEXT NOT NULL CHECK (
        estado IN ('pendiente', 'asignada', 'en_camino', 'entregada', 'cancelada')
    ),
    creado_en TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS seguimiento (
    seguimiento_id BIGSERIAL PRIMARY KEY,
    pedido_id TEXT NOT NULL REFERENCES pedidos (pedido_id) ON DELETE CASCADE,
    estado TEXT NOT NULL CHECK (
        estado IN ('pendiente', 'asignada', 'en_camino', 'entregada', 'cancelada')
    ),
    fecha TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS seguimiento_pedido_fecha_idx
    ON seguimiento (pedido_id, fecha, seguimiento_id);