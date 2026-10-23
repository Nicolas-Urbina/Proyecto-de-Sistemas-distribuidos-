import express, { Request, Response } from 'express';
import cors from 'cors';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8080;

const MODULO_B_URL = process.env.MODULO_B_URL || 'http://modulo-b:5000/transacciones';
const MODULO_C_URL = process.env.MODULO_C_URL || 'http://modulo-c:6000/auditoria';

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

// puerta de enlace 
app.post('/api/transacciones', async (req: Request, res: Response) => {
  const payload: TransaccionRequest = req.body;
  const { monto, moneda, cuenta_origen, cuenta_destino, descripcion } = payload;

  // 1. Validación del payload de entrada
  if (!monto || !moneda || !cuenta_origen || !cuenta_destino) {
    return res.status(400).json({
      error: 'Payload inválido',
      mensaje: 'Faltan campos obligatorios: monto, moneda, cuenta_origen o cuenta_destino.'
    });
  }

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
      return res.status(502).json({
        error: 'Fallo al auditar con Módulo C',
        status: resModuloC.status,
        detalle: errC
      });
    }

    const dataC: AuditoriaRespuestaC = await resModuloC.json();

    // 4. Retorno exitoso al cliente exterior (Postman/curl)[cite: 1, 4]
    return res.status(201).json({
      mensaje: 'Operación completada exitosamente en el sistema distribuido',
      transaccion: dataB,
      auditoria: dataC
    });

  } catch (error: any) {
    console.error('Error de red interna en Módulo A:', error.message);
    return res.status(503).json({
      error: 'Error de comunicación en red distribuida',
      mensaje: error.message
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Módulo A (Gateway) escuchando en http://0.0.0.0:${PORT}`);
});