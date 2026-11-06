package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type PeticionAuditoria struct {
	Monto         float64 `json:"monto,omitempty"`
	Moneda        string  `json:"moneda,omitempty"`
	CuentaOrigen  string  `json:"cuenta_origen,omitempty"`
	CuentaDestino string  `json:"cuenta_destino,omitempty"`
	Descripcion   string  `json:"descripcion,omitempty"`
	TransaccionID string  `json:"transaccion_id"`
	Evento        string  `json:"evento"`
	OrigenIP      string  `json:"origen_ip"`
	PayloadHash   string  `json:"payload_hash"`
}

type RegistroAuditoria struct {
	ID            primitive.ObjectID `json:"id,omitempty" bson:"_id,omitempty"`
	Monto         float64            `json:"monto,omitempty" bson:"monto,omitempty"`
	Moneda        string             `json:"moneda,omitempty" bson:"moneda,omitempty"`
	CuentaOrigen  string             `json:"cuenta_origen,omitempty" bson:"cuenta_origen,omitempty"`
	CuentaDestino string             `json:"cuenta_destino,omitempty" bson:"cuenta_destino,omitempty"`
	Descripcion   string             `json:"descripcion,omitempty" bson:"descripcion,omitempty"`
	TransaccionID string             `json:"transaccion_id" bson:"transaccion_id"`
	Evento        string             `json:"evento" bson:"evento"`
	OrigenIP      string             `json:"origen_ip" bson:"origen_ip"`
	PayloadHash   string             `json:"payload_hash" bson:"payload_hash"`
	FechaRegistro time.Time          `json:"fecha_registro" bson:"fecha_registro"`
}

type RespuestaAuditoria struct {
	AuditoriaID string `json:"auditoria_id"`
	Estado      string `json:"estado"`
	Timestamp   string `json:"timestamp"`
}

type RespuestaEstado struct {
	Servicio string `json:"Servicio"`
	Modulo   string `json:"Módulo"`
	Estado   string `json:"Estado"`
}

var (
	coleccionAuditoria *mongo.Collection
	clienteMongo       *mongo.Client
)

func main() {
	puerto := os.Getenv("PORT")
	if puerto == "" {
		puerto = "6001"
	}

	urlMongo := os.Getenv("MONGO_URI")
	if urlMongo == "" {
		urlMongo = "mongodb://localhost:27017"
	}

	nombreDB := os.Getenv("MONGO_DB")
	if nombreDB == "" {
		nombreDB = "auditoria_db"
	}

	// Conectar a MongoDB con timeout de 5 segundos
	contexto, cancelar := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelar()

	cliente, errorConexion := mongo.Connect(contexto, options.Client().ApplyURI(urlMongo))
	if errorConexion != nil {
		fmt.Println("[AVISO] No se pudo conectar a MongoDB:", errorConexion)
	} else {
		errorPing := cliente.Ping(contexto, nil)
		if errorPing != nil {
			fmt.Println("[AVISO] MongoDB no respondió al ping:", errorPing)
		} else {
			fmt.Println("[OK] Conectado exitosamente a MongoDB en:", urlMongo)
			clienteMongo = cliente
			coleccionAuditoria = cliente.Database(nombreDB).Collection("historial_transacciones")
		}
	}

	// Rutas de estado y salud (compatibles con el formato de Módulo B y Módulo A)
	http.HandleFunc("/", manejarRaiz)
	http.HandleFunc("/health", manejarEstadoServidor)
	http.HandleFunc("/api/iniciacion", manejarEstadoServidor)

	// Rutas de auditoría (soporta tanto /auditoria requerida por Módulo A como /api/auditoria)
	http.HandleFunc("/auditoria", manejarAuditoria)
	http.HandleFunc("/auditoria/", manejarAuditoria)
	http.HandleFunc("/api/auditoria", manejarAuditoria)

	direccion := ":" + puerto
	fmt.Printf("[INICIO] Servidor Módulo C (Auditoría) activo y escuchando en el puerto %s (http://0.0.0.0:%s)\n", puerto, puerto)
	errorServidor := http.ListenAndServe(direccion, nil)
	if errorServidor != nil {
		fmt.Println("[ERROR] Error al arrancar el servidor:", errorServidor)
	}
}

// manejarRaiz responde en GET / con el formato estandarizado del proyecto
func manejarRaiz(respuesta http.ResponseWriter, peticion *http.Request) {
	if peticion.URL.Path != "/" {
		http.NotFound(respuesta, peticion)
		return
	}
	respuesta.Header().Set("Content-Type", "application/json")
	respuesta.Header().Set("Access-Control-Allow-Origin", "*")
	json.NewEncoder(respuesta).Encode(RespuestaEstado{
		Servicio: "Auditoría",
		Modulo:   "C",
		Estado:   "Online",
	})
}

// manejarEstadoServidor endpoint adicional de health check
func manejarEstadoServidor(respuesta http.ResponseWriter, peticion *http.Request) {
	respuesta.Header().Set("Content-Type", "application/json")
	respuesta.Header().Set("Access-Control-Allow-Origin", "*")
	if clienteMongo == nil {
		http.Error(respuesta, `{"error":"MongoDB no disponible"}`, http.StatusServiceUnavailable)
		return
	}
	contexto, cancelar := context.WithTimeout(peticion.Context(), 2*time.Second)
	defer cancelar()
	if err := clienteMongo.Ping(contexto, nil); err != nil {
		http.Error(respuesta, `{"error":"MongoDB no disponible"}`, http.StatusServiceUnavailable)
		return
	}
	respuesta.WriteHeader(http.StatusOK)
	respuesta.Write([]byte(`{"mensaje": "El servidor Modulo C (Go) esta activo", "estado": "exitoso"}`))
}

// manejarAuditoria procesa el registro y la consulta de eventos de auditoría
func manejarAuditoria(respuesta http.ResponseWriter, peticion *http.Request) {
	respuesta.Header().Set("Content-Type", "application/json")
	respuesta.Header().Set("Access-Control-Allow-Origin", "*")
	respuesta.Header().Set("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS")
	respuesta.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if peticion.Method == http.MethodOptions {
		respuesta.WriteHeader(http.StatusOK)
		return
	}

	switch peticion.Method {
	case http.MethodPost:
		var entrada PeticionAuditoria
		errorDecodificar := json.NewDecoder(peticion.Body).Decode(&entrada)
		if errorDecodificar != nil {
			respuesta.WriteHeader(http.StatusBadRequest)
			respuesta.Write([]byte(`{"error": "El payload enviado no es un JSON valido"}`))
			return
		}

		if entrada.TransaccionID == "" {
			entrada.TransaccionID = fmt.Sprintf("tx-%d", time.Now().UnixNano())
		}
		if entrada.PayloadHash == "" {
			textoParaHash := fmt.Sprintf("%.2f-%s-%s-%s", entrada.Monto, entrada.Moneda, entrada.CuentaOrigen, entrada.CuentaDestino)
			hash := sha256.Sum256([]byte(textoParaHash))
			entrada.PayloadHash = hex.EncodeToString(hash[:])
		}
		if entrada.Evento == "" {
			entrada.Evento = "TRANSACCION_REGISTRADA"
		}

		ahora := time.Now().UTC()
		nuevaID := primitive.NewObjectID()

		nuevaTraza := RegistroAuditoria{
			ID:            nuevaID,
			Monto:         entrada.Monto,
			Moneda:        entrada.Moneda,
			CuentaOrigen:  entrada.CuentaOrigen,
			CuentaDestino: entrada.CuentaDestino,
			Descripcion:   entrada.Descripcion,
			TransaccionID: entrada.TransaccionID,
			Evento:        entrada.Evento,
			OrigenIP:      entrada.OrigenIP,
			PayloadHash:   entrada.PayloadHash,
			FechaRegistro: ahora,
		}

		idString := nuevaID.Hex()

		if coleccionAuditoria == nil {
			respuesta.WriteHeader(http.StatusServiceUnavailable)
			respuesta.Write([]byte(`{"error": "MongoDB no disponible", "mensaje": "La auditoría no se registró."}`))
			return
		}

		contextoGuardado, cancelarGuardado := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancelarGuardado()
		if _, errorInsertar := coleccionAuditoria.InsertOne(contextoGuardado, nuevaTraza); errorInsertar != nil {
			fmt.Println("[ERROR] No se pudo guardar la auditoria en MongoDB:", errorInsertar)
			respuesta.WriteHeader(http.StatusServiceUnavailable)
			respuesta.Write([]byte(`{"error": "MongoDB no disponible", "mensaje": "La auditoría no se registró."}`))
			return
		}
		fmt.Printf("[OK] Auditoria registrada en MongoDB | ID: %s | TransaccionID: %s\n", idString, entrada.TransaccionID)

		// Responder al Módulo A exactamente con la estructura esperada
		respuesta.WriteHeader(http.StatusCreated)
		json.NewEncoder(respuesta).Encode(RespuestaAuditoria{
			AuditoriaID: idString,
			Estado:      "REGISTRADO",
			Timestamp:   ahora.Format(time.RFC3339),
		})

	case http.MethodGet:
		listaDeTrazas := make([]RegistroAuditoria, 0)

		if coleccionAuditoria == nil {
			respuesta.WriteHeader(http.StatusServiceUnavailable)
			respuesta.Write([]byte(`{"error": "MongoDB no disponible"}`))
			return
		}

		contextoConsulta, cancelarConsulta := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelarConsulta()
		cursor, errorConsulta := coleccionAuditoria.Find(contextoConsulta, bson.M{})
		if errorConsulta != nil {
			respuesta.WriteHeader(http.StatusServiceUnavailable)
			respuesta.Write([]byte(`{"error": "No se pudo consultar MongoDB"}`))
			return
		}
		defer cursor.Close(contextoConsulta)
		for cursor.Next(contextoConsulta) {
			var traza RegistroAuditoria
			if err := cursor.Decode(&traza); err != nil {
				respuesta.WriteHeader(http.StatusInternalServerError)
				respuesta.Write([]byte(`{"error": "No se pudo leer una auditoría"}`))
				return
			}
			listaDeTrazas = append(listaDeTrazas, traza)
		}
		if errorCursor := cursor.Err(); errorCursor != nil {
			respuesta.WriteHeader(http.StatusServiceUnavailable)
			respuesta.Write([]byte(`{"error": "No se pudo completar la consulta en MongoDB"}`))
			return
		}

		respuesta.WriteHeader(http.StatusOK)
		json.NewEncoder(respuesta).Encode(listaDeTrazas)

	case http.MethodDelete:
		transaccionID := peticion.URL.Query().Get("transaccion_id")
		if transaccionID == "" {
			respuesta.WriteHeader(http.StatusBadRequest)
			respuesta.Write([]byte(`{"error": "El parámetro transaccion_id es obligatorio"}`))
			return
		}
		if coleccionAuditoria == nil {
			respuesta.WriteHeader(http.StatusServiceUnavailable)
			respuesta.Write([]byte(`{"error": "MongoDB no disponible"}`))
			return
		}

		contextoEliminacion, cancelarEliminacion := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelarEliminacion()
		resultado, errorEliminacion := coleccionAuditoria.DeleteMany(
			contextoEliminacion,
			bson.M{"transaccion_id": transaccionID},
		)
		if errorEliminacion != nil {
			respuesta.WriteHeader(http.StatusServiceUnavailable)
			respuesta.Write([]byte(`{"error": "No se pudo eliminar la auditoría en MongoDB"}`))
			return
		}

		respuesta.WriteHeader(http.StatusOK)
		json.NewEncoder(respuesta).Encode(map[string]interface{}{
			"transaccion_id":        transaccionID,
			"auditorias_eliminadas": resultado.DeletedCount,
		})

	default:
		respuesta.WriteHeader(http.StatusMethodNotAllowed)
		respuesta.Write([]byte(`{"error": "Metodo no permitido, use POST, GET o DELETE"}`))
	}
}
