CREATE TABLE IF NOT EXISTS transacciones (
    transaccion_id UUID PRIMARY KEY,
    estado TEXT NOT NULL,
    marca_de_tiempo TIMESTAMPTZ NOT NULL
);