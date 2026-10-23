from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import create_engine, text
import datetime
import logging
import uuid
import os

#Clases de payload y respuesta
class PayloadTransaccion(BaseModel):
    monto: int
    moneda: str
    cuenta_origen: str
    cuenta_destino: str
    descripcion: str

class Respuesta(BaseModel):
    transaccion_id: str
    estado: str
    marca_de_tiempo: str

#Conexión base de datos
database_url = os.environ["DATABASE_URL"]

database_url = database_url.replace(
    "postgresql://",
    "postgresql+psycopg2://",
    1
)

engine = create_engine(database_url)

with engine.connect() as connection:
    result = connection.execute(
        text("SELECT version()")
    )
    print(result.scalar())

#Logger para errores
logger = logging.getLogger(__name__)

#Inicializar FastAPI
app = FastAPI()

print("Servicio de transacciones activo y escuchando en el puerto 5000.")

#Mensajes de error
@app.exception_handler(RequestValidationError)
async def manejar_error_validacion(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    detalles = [
        {
            "campo": ".".join(str(parte) for parte in error["loc"]),
            "mensaje": error["msg"],
        }
        for error in exc.errors()
    ]
    return JSONResponse(
        status_code=422,
        content={
            "error": "Solicitud inválida",
            "mensaje": "El payload no cumple con el formato requerido.",
            "detalles": detalles,
        },
    )


@app.exception_handler(Exception)
async def manejar_error_interno(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Error inesperado al procesar la solicitud")
    return JSONResponse(
        status_code=500,
        content={
            "error": "Error interno del servidor",
            "mensaje": "No se pudo procesar la transacción.",
        },
    )

#Endpoints
@app.get("/")
def raiz():
    return {"Servicio": "Transacciones", "Módulo": "B", "Estado": "Activo"}

@app.post("/transacciones/") 
def procesar_transaccion(payload: PayloadTransaccion) -> Respuesta:
    transaccion_id = uuid.uuid4()
    marca_de_tiempo = datetime.datetime.now(datetime.timezone.utc)
    estado = "RECIBIDO"

    insertar_transaccion(transaccion_id, marca_de_tiempo, estado)

    response = Respuesta(
        transaccion_id=str(transaccion_id),
        estado=estado,
        marca_de_tiempo=marca_de_tiempo.isoformat(),
    )

    return response

#Interacción con base de datos
def insertar_transaccion(id:str, timestamp:str, estado:str):
    with engine.begin() as connection:
            connection.execute(
                text(
                    """
                    INSERT INTO transacciones (
                        transaccion_id,
                        estado,
                        marca_de_tiempo
                    )
                    VALUES (
                        CAST(:transaccion_id AS UUID),
                        :estado,
                        :marca_de_tiempo
                    )
                    """
                ),
                {
                    "transaccion_id": str(id),
                    "estado": estado,
                    "marca_de_tiempo": timestamp,
                },
            )
