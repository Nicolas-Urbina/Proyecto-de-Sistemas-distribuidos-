import express, { Request, Response } from 'express';
import cors from 'cors';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8080;

const MODULO_B_URL = process.env.MODULO_B_URL || 'http://modulo-b:5000/transacciones';
const MODULO_B_PEDIDOS_URL = process.env.MODULO_B_PEDIDOS_URL || 'http://modulo-b:5000/pedidos';
const MODULO_B_ASIGNAR_URL = process.env.MODULO_B_ASIGNAR_URL || 'http://modulo-b:5000/entregas/asignar';
const MODULO_B_ESTADO_URL = process.env.MODULO_B_ESTADO_URL || 'http://modulo-b:5000/entregas';
const MODULO_B_SEGUIMIENTO_URL = process.env.MODULO_B_SEGUIMIENTO_URL || 'http://modulo-b:5000/pedidos';
const MODULO_B_CANCELAR_URL = process.env.MODULO_B_CANCELAR_URL || 'http://modulo-b:5000/transacciones';
const MODULO_C_URL = process.env.MODULO_C_URL || 'http://modulo-c:6001/auditoria';

// Middlewares
app.use(cors());
app.use(express.json());

// Contratos de interfaces según el documento del proyecto
interface TransaccionRequest {
  monto: number;
  moneda: string;
  cuenta_origen: string;
  cuenta_destino: string;
  descripcion?: string;
}

interface TransaccionRespuestaB {
  transaccion_id: string;
  estado: string;
  marca_de_tiempo: string;
}

interface AuditoriaRespuestaC {
  auditoria_id: string;
  estado: string;
  timestamp: string;
}

interface PedidoRequest {
  cliente: string;
  direccion: string;
  descripcion: string;
}

interface AsignacionRequest {
  pedido_id: string;
  repartidor: string;
}

interface EstadoEntregaRequest {
  estado: string;
}

async function compensarTransaccion(transaccionId: string): Promise<boolean> {
  try {
    const respuesta = await fetch(`${MODULO_B_CANCELAR_URL}/${encodeURIComponent(transaccionId)}`, {
      method: 'DELETE'
    });
    return respuesta.ok;
  } catch (error: unknown) {
    const mensaje = error instanceof Error ? error.message : 'Error desconocido';
    console.error('No se pudo compensar la operación en Módulo B:', mensaje);
    return false;
  }
}

// puerta de enlace 
app.post('/api/transacciones', async (req: Request, res: Response) => {
  const body: unknown = req.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return res.status(400).json({
      error: 'Payload inválido',
      mensaje: 'El cuerpo de la solicitud debe ser un objeto JSON.'
    });
  }

  const payload = body as Partial<TransaccionRequest>;
  const { monto, moneda, cuenta_origen, cuenta_destino, descripcion } = payload;

  // 1. Validación del payload de entrada
  if (!monto || !moneda || !cuenta_origen || !cuenta_destino) {
    return res.status(400).json({
      error: 'Payload inválido',
      mensaje: 'Faltan campos obligatorios: monto, moneda, cuenta_origen o cuenta_destino.'
    });
  }

  let transaccionId: string | undefined;
  try {
    // 2. Paso 1 del flujo: Petición HTTP al Módulo B (Dominio / PostgreSQL)
    const resModuloB = await fetch(MODULO_B_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        monto,
        moneda,
        cuenta_origen,
        cuenta_destino,
        descripcion: descripcion || ''
      })
    });

    if (!resModuloB.ok) {
      const errB = await resModuloB.text();
      return res.status(502).json({
        error: 'Fallo al procesar con Módulo B',
        status: resModuloB.status,
        detalle: errB
      });
    }

    const dataB: TransaccionRespuestaB = await resModuloB.json();
    transaccionId = dataB.transaccion_id;

    // 3. Paso 2 del flujo: Generar hash SHA-256 y notificar al Módulo C (Auditoría / MongoDB)
    const payloadHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');

    const origenIp = req.ip || req.socket.remoteAddress || '127.0.0.1';

    const resModuloC = await fetch(MODULO_C_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        monto,
        moneda,
        cuenta_origen,
        cuenta_destino,
        descripcion: descripcion || '',
        transaccion_id: dataB.transaccion_id,
        evento: 'TRANSACCION_REGISTRADA',
        origen_ip: origenIp,
        payload_hash: payloadHash
      })
    });

    if (!resModuloC.ok) {
      const errC = await resModuloC.text();
      const compensada = await compensarTransaccion(dataB.transaccion_id);
      return res.status(502).json({
        error: 'Fallo al auditar con Módulo C',
        status: resModuloC.status,
        detalle: errC,
        compensacion: compensada ? 'La operación fue revertida en PostgreSQL.' : 'No se pudo revertir PostgreSQL.'
      });
    }

    const dataC: AuditoriaRespuestaC = await resModuloC.json();

    // 4. Retorno exitoso al cliente exterior (Postman/curl)[cite: 1, 4]
    return res.status(201).json({
      mensaje: 'Operación completada exitosamente en el sistema distribuido',
      transaccion: dataB,
      auditoria: dataC
    });

  } catch (error: unknown) {
    if (transaccionId) {
      await compensarTransaccion(transaccionId);
    }
    const mensaje = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error de red interna en Módulo A:', mensaje);
    return res.status(503).json({
      error: 'Error de comunicación en red distribuida',
      mensaje
    });
  }
});

// Crea un pedido 
app.post('/api/pedidos', async (req: Request, res: Response) => {
  const body: unknown = req.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return res.status(400).json({
      error: 'Payload inválido',
      mensaje: 'El cuerpo de la solicitud debe ser un objeto JSON.'
    });
  }

  const payload = body as Partial<PedidoRequest>;
  const { cliente, direccion, descripcion } = payload;
  if (
    typeof cliente !== 'string' ||
    !cliente.trim() ||
    typeof direccion !== 'string' ||
    !direccion.trim() ||
    typeof descripcion !== 'string' ||
    !descripcion.trim()
  ) {
    return res.status(400).json({
      error: 'Payload inválido',
      mensaje: 'Los campos cliente, direccion y descripcion son obligatorios.'
    });
  }

  const pedido = {
    cliente: cliente.trim(),
    direccion: direccion.trim(),
    descripcion: descripcion.trim()
  };

  let pedidoIdCreado: string | undefined;
  try {
    const resModuloB = await fetch(MODULO_B_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        monto: 0,
        moneda: 'N/A',
        cuenta_origen: pedido.cliente,
        cuenta_destino: pedido.direccion,
        descripcion: pedido.descripcion
      })
    });

    if (!resModuloB.ok) {
      const errB = await resModuloB.text();
      return res.status(502).json({
        error: 'Fallo al registrar el pedido en Módulo B',
        status: resModuloB.status,
        detalle: errB
      });
    }

    const dataB: TransaccionRespuestaB = await resModuloB.json();
    pedidoIdCreado = dataB.transaccion_id;
    const payloadHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(pedido))
      .digest('hex');
    const origenIp = req.ip || req.socket.remoteAddress || '127.0.0.1';

    const resModuloC = await fetch(MODULO_C_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cuenta_origen: pedido.cliente,
        cuenta_destino: pedido.direccion,
        descripcion: pedido.descripcion,
        transaccion_id: dataB.transaccion_id,
        evento: 'PEDIDO_CREADO',
        origen_ip: origenIp,
        payload_hash: payloadHash
      })
    });

    if (!resModuloC.ok) {
      const errC = await resModuloC.text();
      const compensada = await compensarTransaccion(dataB.transaccion_id);
      return res.status(502).json({
        error: 'Fallo al auditar el pedido en Módulo C',
        status: resModuloC.status,
        detalle: errC,
        compensacion: compensada ? 'El pedido fue revertido en PostgreSQL.' : 'No se pudo revertir PostgreSQL.'
      });
    }

    const dataC: AuditoriaRespuestaC = await resModuloC.json();
    return res.status(201).json({
      mensaje: 'Pedido creado exitosamente',
      pedido: {
        pedido_id: dataB.transaccion_id,
        cliente: pedido.cliente,
        direccion: pedido.direccion,
        descripcion: pedido.descripcion,
        estado: dataB.estado,
        fecha: dataB.marca_de_tiempo
      },
      auditoria: dataC
    });
  } catch (error: unknown) {
    if (pedidoIdCreado) {
      await compensarTransaccion(pedidoIdCreado);
    }
    const mensaje = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error de red interna al crear pedido:', mensaje);
    return res.status(503).json({
      error: 'Error de comunicación en red distribuida',
      mensaje
    });
  }
});

// Consulta pedidos: el gateway no persiste ni transforma la respuesta de B.
app.get('/api/pedidos', async (_req: Request, res: Response) => {
  try {
    const resModuloB = await fetch(MODULO_B_PEDIDOS_URL);
    const contenido = await resModuloB.text();

    if (!resModuloB.ok) {
      return res.status(502).json({
        error: 'Fallo al consultar pedidos en Módulo B',
        status: resModuloB.status,
        detalle: contenido
      });
    }

    try {
      return res.status(resModuloB.status).json(JSON.parse(contenido));
    } catch {
      return res.status(502).json({
        error: 'Respuesta inválida de Módulo B',
        mensaje: 'El servicio de pedidos no devolvió JSON válido.'
      });
    }
  } catch (error: unknown) {
    const mensaje = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error de red al consultar pedidos:', mensaje);
    return res.status(503).json({
      error: 'Error de comunicación en red distribuida',
      mensaje
    });
  }
});

// Consulta las auditorías persistidas en MongoDB a través del gateway.
app.get('/api/auditoria', async (_req: Request, res: Response) => {
  try {
    const resModuloC = await fetch(MODULO_C_URL);
    const contenido = await resModuloC.text();

    if (!resModuloC.ok) {
      return res.status(resModuloC.status === 503 ? 503 : 502).json({
        error: 'Fallo al consultar auditorías en Módulo C',
        status: resModuloC.status,
        detalle: contenido
      });
    }

    try {
      return res.status(200).json(JSON.parse(contenido));
    } catch {
      return res.status(502).json({
        error: 'Respuesta inválida de Módulo C',
        mensaje: 'El servicio de auditoría no devolvió JSON válido.'
      });
    }
  } catch (error: unknown) {
    const mensaje = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error de red al consultar auditorías:', mensaje);
    return res.status(503).json({
      error: 'Error de comunicación en red distribuida',
      mensaje
    });
  }
});

// Elimina una transacción/pedido y sus auditorías asociadas.
app.delete('/api/transacciones/:transaccion_id', async (req: Request, res: Response) => {
  const transaccionId = req.params.transaccion_id;
  if (typeof transaccionId !== 'string' || !transaccionId.trim()) {
    return res.status(400).json({
      error: 'Payload inválido',
      mensaje: 'El transaccion_id es obligatorio.'
    });
  }

  try {
    const resModuloB = await fetch(
      `${MODULO_B_CANCELAR_URL}/${encodeURIComponent(transaccionId.trim())}`,
      { method: 'DELETE' }
    );
    const contenidoB = await resModuloB.text();
    if (!resModuloB.ok) {
      return res.status(resModuloB.status === 404 ? 404 : 502).json({
        error: 'No se pudo eliminar la transacción en Módulo B',
        status: resModuloB.status,
        detalle: contenidoB
      });
    }

    const resModuloC = await fetch(
      `${MODULO_C_URL}?transaccion_id=${encodeURIComponent(transaccionId.trim())}`,
      { method: 'DELETE' }
    );
    const contenidoC = await resModuloC.text();
    if (!resModuloC.ok) {
      return res.status(503).json({
        error: 'La transacción fue eliminada, pero no se pudo eliminar su auditoría',
        status: resModuloC.status,
        detalle: contenidoC
      });
    }

    let auditoria: unknown;
    try {
      auditoria = JSON.parse(contenidoC);
    } catch {
      auditoria = { detalle: contenidoC };
    }
    return res.status(200).json({
      mensaje: 'Transacción y auditorías eliminadas',
      transaccion_id: transaccionId.trim(),
      auditoria
    });
  } catch (error: unknown) {
    const mensaje = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error de red al eliminar la transacción:', mensaje);
    return res.status(503).json({
      error: 'Error de comunicación en red distribuida',
      mensaje
    });
  }
});

// Comprueba que las dos bases de datos respondan antes de probar una operación.
app.get('/api/salud', async (_req: Request, res: Response) => {
  const [postgres, mongo] = await Promise.all([
    fetch(`${MODULO_B_URL.replace(/\/transacciones\/?$/, '')}/bd/listo`),
    fetch(`${MODULO_C_URL.replace(/\/api\/auditoria\/?$/, '')}/health`)
  ].map(async (promesa) => {
    try {
      const respuesta = await promesa;
      return { disponible: respuesta.ok, http: respuesta.status };
    } catch {
      return { disponible: false, http: null };
    }
  }));

  const disponible = postgres.disponible && mongo.disponible;
  return res.status(disponible ? 200 : 503).json({
    estado: disponible ? 'ok' : 'degradado',
    bases_de_datos: {
      postgres,
      mongo
    }
  });
});

// Asigna un repartidor y registra el evento en el servicio de auditoría.
app.post('/api/entregas/asignar', async (req: Request, res: Response) => {
  const body: unknown = req.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return res.status(400).json({
      error: 'Payload inválido',
      mensaje: 'El cuerpo de la solicitud debe ser un objeto JSON.'
    });
  }

  const payload = body as Partial<AsignacionRequest>;
  const { pedido_id, repartidor } = payload;
  if (
    typeof pedido_id !== 'string' ||
    !pedido_id.trim() ||
    typeof repartidor !== 'string' ||
    !repartidor.trim()
  ) {
    return res.status(400).json({
      error: 'Payload inválido',
      mensaje: 'Los campos pedido_id y repartidor son obligatorios.'
    });
  }

  const asignacion = {
    pedido_id: pedido_id.trim(),
    repartidor: repartidor.trim()
  };

  try {
    const resModuloB = await fetch(MODULO_B_ASIGNAR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(asignacion)
    });

    const contenidoB = await resModuloB.text();
    if (!resModuloB.ok) {
      return res.status(502).json({
        error: 'Fallo al asignar la entrega en Módulo B',
        status: resModuloB.status,
        detalle: contenidoB
      });
    }

    let dataB: unknown;
    try {
      dataB = JSON.parse(contenidoB);
    } catch {
      return res.status(502).json({
        error: 'Respuesta inválida de Módulo B',
        mensaje: 'El servicio de entregas no devolvió JSON válido.'
      });
    }

    const payloadHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(asignacion))
      .digest('hex');
    const origenIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
    const resModuloC = await fetch(MODULO_C_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transaccion_id: asignacion.pedido_id,
        descripcion: `Repartidor asignado: ${asignacion.repartidor}`,
        evento: 'REPARTIDOR_ASIGNADO',
        origen_ip: origenIp,
        payload_hash: payloadHash
      })
    });

    if (!resModuloC.ok) {
      const errC = await resModuloC.text();
      return res.status(502).json({
        error: 'Fallo al auditar la asignación en Módulo C',
        status: resModuloC.status,
        detalle: errC
      });
    }

    const dataC: AuditoriaRespuestaC = await resModuloC.json();
    return res.status(201).json({
      entrega: dataB,
      auditoria: dataC
    });
  } catch (error: unknown) {
    const mensaje = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error de red al asignar entrega:', mensaje);
    return res.status(503).json({
      error: 'Error de comunicación en red distribuida',
      mensaje
    });
  }
});

// Actualiza el estado en B y registra el cambio en C.
app.patch('/api/entregas/:pedido_id/estado', async (req: Request, res: Response) => {
  const pedidoIdParam = req.params.pedido_id;
  if (typeof pedidoIdParam !== 'string' || !pedidoIdParam.trim()) {
    return res.status(400).json({
      error: 'Payload inválido',
      mensaje: 'El pedido_id es obligatorio.'
    });
  }
  const pedidoId = pedidoIdParam.trim();

  const body: unknown = req.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return res.status(400).json({
      error: 'Payload inválido',
      mensaje: 'El cuerpo de la solicitud debe ser un objeto JSON.'
    });
  }

  const payload = body as Partial<EstadoEntregaRequest>;
  if (typeof payload.estado !== 'string' || !payload.estado.trim()) {
    return res.status(400).json({
      error: 'Payload inválido',
      mensaje: 'El campo estado es obligatorio.'
    });
  }

  const actualizacion = {
    pedido_id: pedidoId,
    estado: payload.estado.trim()
  };

  try {
    const resModuloB = await fetch(
      `${MODULO_B_ESTADO_URL}/${encodeURIComponent(pedidoId)}/estado`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: actualizacion.estado })
      }
    );
    const contenidoB = await resModuloB.text();

    if (!resModuloB.ok) {
      return res.status(502).json({
        error: 'Fallo al actualizar el estado en Módulo B',
        status: resModuloB.status,
        detalle: contenidoB
      });
    }

    let dataB: unknown;
    try {
      dataB = JSON.parse(contenidoB);
    } catch {
      return res.status(502).json({
        error: 'Respuesta inválida de Módulo B',
        mensaje: 'El servicio de entregas no devolvió JSON válido.'
      });
    }

    const payloadHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(actualizacion))
      .digest('hex');
    const origenIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
    const resModuloC = await fetch(MODULO_C_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transaccion_id: pedidoId,
        descripcion: `Estado actualizado a: ${actualizacion.estado}`,
        evento: 'ESTADO_ENTREGA_ACTUALIZADO',
        origen_ip: origenIp,
        payload_hash: payloadHash
      })
    });

    if (!resModuloC.ok) {
      const errC = await resModuloC.text();
      return res.status(502).json({
        error: 'Fallo al auditar el cambio de estado en Módulo C',
        status: resModuloC.status,
        detalle: errC
      });
    }

    const dataC: AuditoriaRespuestaC = await resModuloC.json();
    return res.status(200).json({
      entrega: dataB,
      auditoria: dataC
    });
  } catch (error: unknown) {
    const mensaje = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error de red al actualizar estado:', mensaje);
    return res.status(503).json({
      error: 'Error de comunicación en red distribuida',
      mensaje
    });
  }
});

// Consulta el historial directamente en B sin conocer su almacenamiento.
app.get('/api/entregas/:pedido_id', async (req: Request, res: Response) => {
  const pedidoIdParam = req.params.pedido_id;
  if (typeof pedidoIdParam !== 'string' || !pedidoIdParam.trim()) {
    return res.status(400).json({
      error: 'Payload inválido',
      mensaje: 'El pedido_id es obligatorio.'
    });
  }
  const pedidoId = pedidoIdParam.trim();

  try {
    const resModuloB = await fetch(
      `${MODULO_B_SEGUIMIENTO_URL}/${encodeURIComponent(pedidoId)}/seguimiento`
    );
    const contenido = await resModuloB.text();

    if (!resModuloB.ok) {
      return res.status(502).json({
        error: 'Fallo al consultar el seguimiento en Módulo B',
        status: resModuloB.status,
        detalle: contenido
      });
    }

    try {
      return res.status(resModuloB.status).json(JSON.parse(contenido));
    } catch {
      return res.status(502).json({
        error: 'Respuesta inválida de Módulo B',
        mensaje: 'El servicio de seguimiento no devolvió JSON válido.'
      });
    }
  } catch (error: unknown) {
    const mensaje = error instanceof Error ? error.message : 'Error desconocido';
    console.error('Error de red al consultar seguimiento:', mensaje);
    return res.status(503).json({
      error: 'Error de comunicación en red distribuida',
      mensaje
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Módulo A (Gateway) escuchando en http://0.0.0.0:${PORT}`);
});
