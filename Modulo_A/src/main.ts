import express, { Request, Response } from 'express';
import cors from 'cors';

const app = express();
const PORT = 8080; // Requisito de la arquitectura del proyecto

// Middlewares
app.use(cors());
app.use(express.json());


interface TransaccionRequest {
  monto: number;
  moneda: string;
  cuenta_origen: string;
  cuenta_destino: string;
  descripcion?: string;
}

app.get('/api/iniciacion', (req: Request, res: Response) => {
  res.json({ mensaje: '¡El servidor esta activo', estado: 'exitoso' });
  console.log('el servidor esta activo');
});

app.post('/api/transacciones', (req: Request, res: Response) => {
  const { monto, moneda, cuenta_origen, cuenta_destino, descripcion }: TransaccionRequest = req.body;

  // Validación básica de los campos requeridos
  if (!monto || !moneda || !cuenta_origen || !cuenta_destino) {
    return res.status(400).json({
      error: 'Payload incompleto',
      mensaje: 'Los campos monto, moneda, cuenta_origen y cuenta_destino son obligatorios.'
    });
  }

  // Por ahora simulamos la respuesta exitosa
  // (Aquí luego irán los fetch hacia el Módulo B y Módulo C)
  return res.status(201).json({
    mensaje: 'Transacción recibida y validada por Módulo A',
    datos_recibidos: {
      monto,
      moneda,
      cuenta_origen,
      cuenta_destino,
      descripcion: descripcion || 'Sin descripción'
    }
  });
});

app.patch('/api/actualizacion_de_transacciones', (req: Request, res: Response) =>{
    const { monto, moneda, cuenta_origen, cuenta_destino, descripcion }: TransaccionRequest = req.body;
    const { id } = req.params;
    if (!monto && !moneda && !cuenta_origen && !cuenta_destino && !descripcion) {
    return res.status(400).json({
      error: 'Payload sin campos nuevos',
      mensaje: 'Se necesita por lo menos un campo nuevo para hacer la actualizacion.'
        });
    }

    return res.status(200).json({
    mensaje: `Transacción ${id} actualizada con éxito en Módulo A`,
    transaccion_id: id,
    datos_actualizados: {
      ...(monto !== undefined && { monto }),
      ...(moneda !== undefined && { moneda }),
      ...(cuenta_origen !== undefined && { cuenta_origen }),
      ...(cuenta_destino !== undefined && { cuenta_destino }),
      ...(descripcion !== undefined && { descripcion })
    }
  });
});


// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});