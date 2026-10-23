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
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// Datos que recibimos desde el Modulo A
type PeticionTransaccion struct {
	Monto         float64 `json:"monto"`
	Moneda        string  `json:"moneda"`
	CuentaOrigen  string  `json:"cuenta_origen"`
	CuentaDestino string  `json:"cuenta_destino"`
	Descripcion   string  `json:"descripcion"`
}

// Estructura que guardaremos en la Base de Datos (MongoDB)
type RegistroAuditoria struct {
	Monto         float64   `json:"monto" bson:"monto"`
	Moneda        string    `json:"moneda" bson:"moneda"`
	CuentaOrigen  string    `json:"cuenta_origen" bson:"cuenta_origen"`
	CuentaDestino string    `json:"cuenta_destino" bson:"cuenta_destino"`
	HashOperacion string    `json:"hash_operacion" bson:"hash_operacion"`
	NodoOrigen    string    `json:"nodo_origen" bson:"nodo_origen"`
	FechaLlegada  time.Time `json:"fecha_llegada" bson:"fecha_llegada"`
}

// Variable global para interactuar con la coleccion de MongoDB
var coleccionAuditoria *mongo.Collection

func main() {
	puerto := os.Getenv("PORT")
	if puerto == "" {
		puerto = "6000" 
	}

	urlMongo := os.Getenv("MONGO_URI")
	if urlMongo == "" {
		urlMongo = "mongodb://db-nosql:27017" 
	}

	//Conectar a MongoDB
	contexto, cancelar := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelar()

	clienteMongo, errorConexion := mongo.Connect(contexto, options.Client().ApplyURI(urlMongo))
	if errorConexion != nil {
		fmt.Println("[AVISO] No se pudo conectar a MongoDB:", errorConexion)
	} else {
		errorPing := clienteMongo.Ping(contexto, nil)
		if errorPing != nil {
			fmt.Println("[AVISO] MongoDB no respondio al ping:", errorPing)
		} else {
			fmt.Println("[OK] Conectado exitosamente a MongoDB en:", urlMongo)
			coleccionAuditoria = clienteMongo.Database("auditoria_db").Collection("historial_transacciones")
		}
	}

	// Registrar rutas HTTP
	http.HandleFunc("/api/iniciacion", manejarEstadoServidor)
	http.HandleFunc("/health", manejarEstadoServidor)
	http.HandleFunc("/api/auditoria", manejarAuditoria)

	// Iniciar el servidor
	direccion := ":" + puerto
	fmt.Println("[INICIO] Servidor Modulo C escuchando en http://localhost" + direccion)
	errorServidor := http.ListenAndServe(direccion, nil)
	if errorServidor != nil {
		fmt.Println("[ERROR] Error al arrancar el servidor:", errorServidor)
	}
}

// Funcion para registrar y consultar eventos de auditoria
func manejarAuditoria(respuesta http.ResponseWriter, peticion *http.Request) {
	// Permitir llamadas cruzadas (CORS) y responder en formato JSON
	respuesta.Header().Set("Content-Type", "application/json")
	respuesta.Header().Set("Access-Control-Allow-Origin", "*")

	if peticion.Method == "POST" {

		var datosEntrada PeticionTransaccion
		errorDecodificar := json.NewDecoder(peticion.Body).Decode(&datosEntrada)

		if errorDecodificar != nil {
			respuesta.WriteHeader(http.StatusBadRequest)
			respuesta.Write([]byte(`{"error": "Los datos enviados no tienen un formato JSON valido"}`))
			return
		}

		if datosEntrada.Monto <= 0 || datosEntrada.Moneda == "" || datosEntrada.CuentaOrigen == "" || datosEntrada.CuentaDestino == "" {
			respuesta.WriteHeader(http.StatusBadRequest)
			respuesta.Write([]byte(`{"error": "Faltan datos obligatorios de la transaccion"}`))
			return
		}

		// Calcular el Hash SHA-256 usando los datos de la transaccion
		textoParaHash := fmt.Sprintf("%.2f-%s-%s-%s",
			datosEntrada.Monto,
			datosEntrada.Moneda,
			datosEntrada.CuentaOrigen,
			datosEntrada.CuentaDestino,
		)
		bytesHash := sha256.Sum256([]byte(textoParaHash))
		hashEnTexto := hex.EncodeToString(bytesHash[:])

		// Crear el objeto que guardaremos en la base de datos
		nuevaTraza := RegistroAuditoria{
			Monto:         datosEntrada.Monto,
			Moneda:        datosEntrada.Moneda,
			CuentaOrigen:  datosEntrada.CuentaOrigen,
			CuentaDestino: datosEntrada.CuentaDestino,
			HashOperacion: hashEnTexto,
			NodoOrigen:    "modulo-a",
			FechaLlegada:  time.Now(),
		}

		// Guardar en MongoDB si la coleccion esta activa
		if coleccionAuditoria != nil {
			contextoGuardado, cancelarGuardado := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancelarGuardado()

			_, errorInsertar := coleccionAuditoria.InsertOne(contextoGuardado, nuevaTraza)
			if errorInsertar != nil {
				fmt.Println("[ERROR] No se pudo guardar la traza en Mongo:", errorInsertar)
			} else {
				fmt.Println("[OK] Traza guardada en MongoDB con Hash:", hashEnTexto)
			}
		} else {
			fmt.Println("[AVISO] Mongo no disponible. Traza registrada solo en consola con Hash:", hashEnTexto)
		}

		// Responder al Modulo A con confirmacion de guardado
		respuesta.WriteHeader(http.StatusCreated)
		json.NewEncoder(respuesta).Encode(map[string]interface{}{
			"mensaje":        "Traza registrada correctamente en Modulo C",
			"hash_operacion": hashEnTexto,
			"fecha_llegada":  nuevaTraza.FechaLlegada,
			"estado":         "guardado",
		})

		//Si llega una peticion GET (consultar todas las trazas guardadas)
	} else if peticion.Method == "GET" {

		listaDeTrazas := []RegistroAuditoria{}

		if coleccionAuditoria != nil {
			contextoConsulta, cancelarConsulta := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancelarConsulta()

			cursor, errorConsulta := coleccionAuditoria.Find(contextoConsulta, bson.M{})
			if errorConsulta == nil {
				defer cursor.Close(contextoConsulta)

				for cursor.Next(contextoConsulta) {
					var trazaEncontrada RegistroAuditoria
					errorLeer := cursor.Decode(&trazaEncontrada)
					if errorLeer == nil {
						listaDeTrazas = append(listaDeTrazas, trazaEncontrada)
					}
				}
			}
		}

		respuesta.WriteHeader(http.StatusOK)
		json.NewEncoder(respuesta).Encode(listaDeTrazas)

	} else {
		respuesta.WriteHeader(http.StatusMethodNotAllowed)
		respuesta.Write([]byte(`{"error": "Metodo no permitido, usa POST o GET"}`))
	}
}

// Endpoint para comprobar si el modulo esta vivo
func manejarEstadoServidor(respuesta http.ResponseWriter, peticion *http.Request) {
	respuesta.Header().Set("Content-Type", "application/json")
	respuesta.WriteHeader(http.StatusOK)
	respuesta.Write([]byte(`{"mensaje": "El servidor Modulo C (Go) esta activo", "estado": "exitoso"}`))
}
