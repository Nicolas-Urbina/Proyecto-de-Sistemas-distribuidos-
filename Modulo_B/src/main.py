from fastapi import FastAPI
from pydantic import BaseModel
import datetime


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

app = FastAPI()

print("Servicio de transacciones activo y escuchando en el puerto 5000.")

@app.get("/")
def raiz():
    return {"Servicio": "Transacciones", "Módulo": "B", "Estado": "Online"}

@app.post("/transacciones/")
def procesar_transaccion(payload: PayloadTransaccion):
    return Respuesta(transaccion_id="23590123", estado="RECIBIDO", marca_de_tiempo=datetime.datetime.now().strftime())