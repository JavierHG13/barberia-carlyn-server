from __future__ import annotations

from pathlib import Path

import nbformat as nbf


ROOT = Path(__file__).resolve().parent
NOTEBOOKS = ROOT / "notebooks"


def md(text: str):
    return nbf.v4.new_markdown_cell(text.strip())


def code(text: str):
    return nbf.v4.new_code_cell(text.strip())


def write_notebook(filename: str, title: str, cells: list):
    NOTEBOOKS.mkdir(parents=True, exist_ok=True)
    nb = nbf.v4.new_notebook()
    nb["metadata"] = {
        "kernelspec": {
            "display_name": "Python 3",
            "language": "python",
            "name": "python3",
        },
        "language_info": {
            "name": "python",
            "pygments_lexer": "ipython3",
        },
    }
    nb["cells"] = [md(f"# {title}"), *cells]
    nbf.write(nb, NOTEBOOKS / filename)


COMMON_SETUP = r"""
from pathlib import Path
import os
import joblib
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
import psycopg2

sns.set_theme(style="whitegrid")

SERVER_ROOT = Path.cwd()
if SERVER_ROOT.name == "notebooks":
    SERVER_ROOT = SERVER_ROOT.parents[1]
elif SERVER_ROOT.name == "ml":
    SERVER_ROOT = SERVER_ROOT.parent

ARTIFACT_DIR = SERVER_ROOT / "ml" / "artifacts"
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

def load_env(path):
    env = {}
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env

env = {**load_env(SERVER_ROOT / ".env"), **os.environ}

def connect():
    conn = psycopg2.connect(
        host=env.get("DB_HOST", "localhost"),
        port=int(env.get("DB_PORT", 5432)),
        user=env.get("DB_USER", "postgres"),
        password=env.get("DB_PASSWORD", ""),
        dbname=env.get("DB_NAME", "db_barberia"),
    )
    with conn.cursor() as cur:
        cur.execute("SET search_path TO core, catalogo, admin, public")
    return conn

conn = connect()
df = pd.read_sql_query("SELECT * FROM analitica.ml_citas_dataset ORDER BY id", conn)
df["fecha"] = pd.to_datetime(df["fecha"])
df["hora"] = pd.to_datetime(df["hora"].astype(str), format="%H:%M:%S", errors="coerce").dt.hour
df.head()
"""


classification_cells = [
    md("""
## Objetivo

Esta libreta entrena un modelo de **clasificacion** para anticipar si una cita puede terminar como **inasistencia**.

La variable objetivo se construye asi:

- `1`: cita con riesgo operativo, cuando el estado historico es `no_show` o `cancelada`.
- `0`: cita asistida, cuando el estado historico es `asistio`.

Se prueban dos modelos:

- **Decision Tree Classifier**: sirve como modelo base, facil de explicar.
- **Random Forest Classifier**: combina varios arboles y suele generalizar mejor. Es el modelo recomendado para este modulo.
"""),
    code(COMMON_SETUP),
    md("""
## 1. Revision inicial del dataset

Primero verificamos cuantas citas hay por estado. Las citas `pendiente` no se usan para entrenar porque aun no sabemos su resultado real.
"""),
    code("""
df["estado_cita"].value_counts().rename_axis("estado").reset_index(name="total")
"""),
    md("""
## 2. Construccion de la variable objetivo

Quitamos citas pendientes y creamos la columna `target_no_show`. Esta columna es lo que el modelo intentara aprender.
"""),
    code("""
data = df[df["estado_cita"] != "pendiente"].copy()
data["target_no_show"] = data["estado_cita"].isin(["no_show", "cancelada"]).astype(int)

data[["estado_cita", "target_no_show"]].value_counts().reset_index(name="total")
"""),
    md("""
## 3. Variables predictoras

Usamos variables que existirian antes de que ocurra la cita:

- sucursal, servicio y barbero
- dia, semana y hora
- precio y duracion del servicio
- si se envio recordatorio
- comportamiento historico del cliente: frecuencia, recencia, gasto y tasa previa de no-show
- canal por el que se genero la cita
"""),
    code("""
from sklearn.compose import ColumnTransformer
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.tree import DecisionTreeClassifier, plot_tree
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, confusion_matrix, classification_report

features = [
    "local_nombre", "servicio_nombre", "barbero_nombre",
    "dia_semana", "semana", "hora", "precio", "duracion",
    "recordatorio_enviado", "frecuencia_cliente", "recencia_dias",
    "gasto_total_cliente", "no_show_rate_cliente", "canal",
]

categorical = ["local_nombre", "servicio_nombre", "barbero_nombre", "canal"]
numeric = [column for column in features if column not in categorical]

X = data[features]
y = data["target_no_show"]

X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.25, random_state=42, stratify=y
)

preprocess = ColumnTransformer([
    ("cat", OneHotEncoder(handle_unknown="ignore"), categorical),
    ("num", StandardScaler(), numeric),
])
"""),
    md("""
## 4. Modelo base: Decision Tree

El arbol de decision es bueno para explicar reglas, pero puede sobreajustarse. Lo usamos como comparacion inicial.
"""),
    code("""
decision_tree = Pipeline([
    ("prep", preprocess),
    ("model", DecisionTreeClassifier(max_depth=5, min_samples_leaf=12, random_state=42)),
])

decision_tree.fit(X_train, y_train)
dt_pred = decision_tree.predict(X_test)

dt_metrics = {
    "accuracy": accuracy_score(y_test, dt_pred),
    "precision": precision_score(y_test, dt_pred, zero_division=0),
    "recall": recall_score(y_test, dt_pred, zero_division=0),
    "f1": f1_score(y_test, dt_pred, zero_division=0),
}

pd.DataFrame([dt_metrics], index=["Decision Tree"])
"""),
    md("""
## 5. Modelo principal: Random Forest

Random Forest entrena muchos arboles con muestras y variables diferentes. La prediccion final se obtiene por votacion/promedio, por eso suele ser mas estable que un solo arbol.
"""),
    code("""
random_forest = Pipeline([
    ("prep", preprocess),
    ("model", RandomForestClassifier(
        n_estimators=160,
        max_depth=9,
        min_samples_leaf=6,
        class_weight="balanced",
        random_state=42,
    )),
])

random_forest.fit(X_train, y_train)
rf_pred = random_forest.predict(X_test)
rf_prob = random_forest.predict_proba(X_test)[:, 1]

rf_metrics = {
    "accuracy": accuracy_score(y_test, rf_pred),
    "precision": precision_score(y_test, rf_pred, zero_division=0),
    "recall": recall_score(y_test, rf_pred, zero_division=0),
    "f1": f1_score(y_test, rf_pred, zero_division=0),
}

pd.DataFrame([dt_metrics, rf_metrics], index=["Decision Tree", "Random Forest"])
"""),
    md("""
## 6. Matriz de confusion

La matriz ayuda a ver donde se equivoca el modelo:

- Verdaderos negativos: citas sin riesgo correctamente detectadas.
- Falsos positivos: citas marcadas en riesgo aunque si asistirian.
- Falsos negativos: citas riesgosas que el modelo no detecto.
- Verdaderos positivos: citas riesgosas detectadas.
"""),
    code("""
cm = confusion_matrix(y_test, rf_pred)
plt.figure(figsize=(5, 4))
sns.heatmap(cm, annot=True, fmt="d", cmap="Blues", xticklabels=["Sin riesgo", "Riesgo"], yticklabels=["Sin riesgo", "Riesgo"])
plt.xlabel("Prediccion")
plt.ylabel("Real")
plt.title("Matriz de confusion - Random Forest")
plt.show()

print(classification_report(y_test, rf_pred, target_names=["Sin riesgo", "Riesgo"]))
"""),
    md("""
## 7. Citas con mayor riesgo

Aplicamos el modelo a citas futuras o pendientes para obtener un ranking de atencion.
"""),
    code("""
candidates = df[df["estado_cita"] == "pendiente"].copy()
if candidates.empty:
    candidates = df.sort_values("fecha", ascending=False).head(80).copy()

candidates["riesgo_no_show"] = random_forest.predict_proba(candidates[features])[:, 1]
top_risk = candidates.sort_values("riesgo_no_show", ascending=False).head(15)

top_risk[["fecha", "hora", "cliente_nombre", "servicio_nombre", "local_nombre", "riesgo_no_show"]]
"""),
    md("""
## 8. Guardado del modelo

Guardamos el modelo entrenado en formato `.joblib`. Este archivo se puede cargar despues para predecir sin volver a entrenar.
"""),
    code("""
artifact_path = ARTIFACT_DIR / "notebook_no_show_random_forest.joblib"
joblib.dump(random_forest, artifact_path)
artifact_path
"""),
]


regression_cells = [
    md("""
## Objetivo

Esta libreta entrena un modelo de **regresion** para pronosticar ingresos semanales por sucursal.

Se comparan dos enfoques:

- **Regresion lineal**: modelo simple y explicable; sirve como linea base.
- **Random Forest Regressor**: modelo no lineal; captura patrones por semana, ocupacion y ticket promedio.
"""),
    code(COMMON_SETUP),
    md("""
## 1. Agregacion semanal

El modelo de ingresos no usa cada cita individual como objetivo. Primero agrupamos las citas completadas por sucursal y semana.
"""),
    code("""
history = df[(df["estado_cita"] == "asistio") & (df["monto_pagado"] > 0)].copy()

weekly = (
    history.groupby(["local_id", "local_nombre", "semana"], as_index=False)
    .agg(
        ingreso=("monto_pagado", "sum"),
        citas=("id", "count"),
        clientes=("cliente_ref", "nunique"),
        ticket=("monto_pagado", "mean"),
        duracion_promedio=("duracion", "mean"),
    )
    .sort_values(["local_id", "semana"])
)

weekly["ocupacion"] = np.clip(weekly["citas"] / 95.0, 0.15, 1.0)
weekly.head()
"""),
    md("""
## 2. Variables del modelo

La variable objetivo es `ingreso`. Las variables explicativas representan volumen, mezcla comercial y ocupacion.
"""),
    code("""
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LinearRegression
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

features = ["local_id", "semana", "citas", "clientes", "ticket", "duracion_promedio", "ocupacion"]
X = weekly[features]
y = weekly["ingreso"]

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.25, random_state=42)
"""),
    md("""
## 3. Modelo base: Regresion lineal

La regresion lineal asume una relacion proporcional entre las variables y el ingreso. Es facil de explicar, pero puede quedarse corta si hay patrones no lineales.
"""),
    code("""
linear_model = LinearRegression()
linear_model.fit(X_train, y_train)
linear_pred = linear_model.predict(X_test)

linear_metrics = {
    "MAE": mean_absolute_error(y_test, linear_pred),
    "RMSE": mean_squared_error(y_test, linear_pred) ** 0.5,
    "R2": r2_score(y_test, linear_pred),
}

pd.DataFrame([linear_metrics], index=["Regresion lineal"])
"""),
    md("""
## 4. Modelo principal: Random Forest Regressor

Random Forest Regressor combina muchos arboles para capturar relaciones no lineales: por ejemplo, semanas con mayor demanda, tickets mas altos y ocupacion.
"""),
    code("""
rf_regressor = RandomForestRegressor(
    n_estimators=180,
    max_depth=8,
    min_samples_leaf=3,
    random_state=42,
)

rf_regressor.fit(X_train, y_train)
rf_pred = rf_regressor.predict(X_test)

rf_metrics = {
    "MAE": mean_absolute_error(y_test, rf_pred),
    "RMSE": mean_squared_error(y_test, rf_pred) ** 0.5,
    "R2": r2_score(y_test, rf_pred),
}

pd.DataFrame([linear_metrics, rf_metrics], index=["Regresion lineal", "Random Forest Regressor"])
"""),
    md("""
## 5. Comparacion visual: real vs predicho

Mientras mas cerca esten los puntos de la linea diagonal, mejor es el ajuste.
"""),
    code("""
comparison = pd.DataFrame({"real": y_test, "predicho": rf_pred})

plt.figure(figsize=(6, 5))
sns.scatterplot(data=comparison, x="real", y="predicho")
limit = max(comparison["real"].max(), comparison["predicho"].max())
plt.plot([0, limit], [0, limit], color="red", linestyle="--")
plt.title("Ingreso real vs ingreso predicho")
plt.show()
"""),
    md("""
## 6. Importancia de variables

Esto permite explicar que variables pesan mas en el pronostico.
"""),
    code("""
importance = pd.DataFrame({
    "variable": features,
    "importancia": rf_regressor.feature_importances_,
}).sort_values("importancia", ascending=False)

plt.figure(figsize=(7, 4))
sns.barplot(data=importance, x="importancia", y="variable", color="#2B6A35")
plt.title("Importancia de variables - Random Forest Regressor")
plt.show()

importance
"""),
    md("""
## 7. Pronostico de las siguientes semanas

Construimos escenarios futuros tomando promedios recientes por sucursal y proyectando las siguientes 4 semanas.
"""),
    code("""
from datetime import date, timedelta

future_rows = []
start = date.today() + timedelta(days=(7 - date.today().weekday()))

for (local_id, local_nombre), group in weekly.groupby(["local_id", "local_nombre"]):
    base = group.tail(4).mean(numeric_only=True)
    for i in range(4):
        week_start = start + timedelta(days=i * 7)
        future_rows.append({
            "local_id": local_id,
            "local_nombre": local_nombre,
            "semana": int(week_start.isocalendar().week),
            "fecha_inicio": week_start,
            "citas": max(15, base["citas"] * (1 + 0.04 * i)),
            "clientes": max(10, base["clientes"] * (1 + 0.03 * i)),
            "ticket": max(120, base["ticket"] * (1 + 0.015 * i)),
            "duracion_promedio": base["duracion_promedio"],
            "ocupacion": float(np.clip(base["ocupacion"] + 0.03 * i, 0.20, 0.96)),
        })

future = pd.DataFrame(future_rows)
future["ingreso_proyectado"] = rf_regressor.predict(future[features])
future[["local_nombre", "semana", "fecha_inicio", "ingreso_proyectado", "ticket", "ocupacion"]]
"""),
    md("""
## 8. Guardado del modelo

Guardamos el modelo de regresion para usarlo desde procesos automatizados.
"""),
    code("""
artifact_path = ARTIFACT_DIR / "notebook_income_random_forest_regressor.joblib"
joblib.dump(rf_regressor, artifact_path)
artifact_path
"""),
]


clustering_cells = [
    md("""
## Objetivo

Esta libreta construye una segmentacion de clientes con **K-Means**.

Como clustering es aprendizaje no supervisado, no hay una variable objetivo. El modelo agrupa clientes por comportamiento:

- frecuencia de visitas
- recencia
- gasto total
- tasa historica de no-show

Tambien se incluyen dos tecnicas para justificar el numero de grupos:

- **Metodo del codo**: compara la inercia para varios valores de K.
- **Dendrograma**: visualiza similitud jerarquica entre clientes.
"""),
    code(COMMON_SETUP),
    md("""
## 1. Dataset a nivel cliente

Agregamos las citas para tener una fila por cliente.
"""),
    code("""
clients = (
    df.groupby(["cliente_ref", "cliente_nombre"], as_index=False)
    .agg(
        frecuencia_90d=("frecuencia_cliente", "max"),
        recencia_dias=("recencia_dias", "min"),
        gasto_total=("gasto_total_cliente", "max"),
        no_show_rate=("no_show_rate_cliente", "max"),
        citas=("id", "count"),
    )
)

clients.head()
"""),
    md("""
## 2. Escalamiento de variables

K-Means usa distancias. Si no escalamos, `gasto_total` dominaria al resto solo por tener numeros mas grandes.
"""),
    code("""
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans, AgglomerativeClustering
from scipy.cluster.hierarchy import dendrogram, linkage

features = ["frecuencia_90d", "recencia_dias", "gasto_total", "no_show_rate"]

scaler = StandardScaler()
X_scaled = scaler.fit_transform(clients[features])
"""),
    md("""
## 3. Metodo del codo

Entrenamos K-Means con varios valores de K. Buscamos el punto donde agregar mas clusters ya no reduce tanto la inercia.
"""),
    code("""
ks = range(2, 9)
inertias = []

for k in ks:
    model = KMeans(n_clusters=k, random_state=42, n_init=12)
    model.fit(X_scaled)
    inertias.append(model.inertia_)

plt.figure(figsize=(7, 4))
plt.plot(list(ks), inertias, marker="o")
plt.xlabel("Numero de clusters K")
plt.ylabel("Inercia")
plt.title("Metodo del codo para K-Means")
plt.show()

pd.DataFrame({"k": list(ks), "inercia": inertias})
"""),
    md("""
## 4. Dendrograma

El dendrograma no entrena K-Means, pero ayuda a entender que tan separados estan los grupos. Para que sea legible, se toma una muestra de clientes.
"""),
    code("""
sample_size = min(80, len(clients))
sample_idx = np.random.RandomState(42).choice(len(clients), size=sample_size, replace=False)
linked = linkage(X_scaled[sample_idx], method="ward")

plt.figure(figsize=(12, 5))
dendrogram(linked, truncate_mode="lastp", p=24)
plt.title("Dendrograma de clientes")
plt.xlabel("Grupos / clientes")
plt.ylabel("Distancia")
plt.show()
"""),
    md("""
## 5. Entrenamiento final con K=4

Con base en la propuesta de negocio y el analisis visual, usamos 4 segmentos:

- VIP frecuentes
- Ocasionales
- Riesgo de fuga
- Nuevos/prueba
"""),
    code("""
kmeans = KMeans(n_clusters=4, random_state=42, n_init=12)
clients["cluster"] = kmeans.fit_predict(X_scaled)

cluster_stats = clients.groupby("cluster")[features].mean()
cluster_stats
"""),
    md("""
## 6. Etiquetado de segmentos

K-Means solo entrega numeros de cluster. Nosotros asignamos nombres de negocio interpretando los promedios.
"""),
    code("""
labels = {}
used = set()

vip = cluster_stats.sort_values(["gasto_total", "frecuencia_90d"], ascending=False).index[0]
labels[vip] = "VIP frecuentes"
used.add(vip)

risk = cluster_stats.drop(index=list(used)).sort_values(["recencia_dias", "no_show_rate"], ascending=False).index[0]
labels[risk] = "Riesgo de fuga"
used.add(risk)

new = cluster_stats.drop(index=list(used)).sort_values("frecuencia_90d", ascending=True).index[0]
labels[new] = "Nuevos/prueba"
used.add(new)

for cluster in cluster_stats.index:
    if cluster not in labels:
        labels[cluster] = "Ocasionales"

clients["segmento"] = clients["cluster"].map(labels)
clients["segmento"].value_counts()
"""),
    md("""
## 7. Visualizacion de segmentos

Graficamos gasto contra recencia para ver como se distribuyen los grupos.
"""),
    code("""
plt.figure(figsize=(8, 5))
sns.scatterplot(
    data=clients,
    x="recencia_dias",
    y="gasto_total",
    hue="segmento",
    size="frecuencia_90d",
    sizes=(30, 180),
)
plt.title("Segmentacion de clientes")
plt.xlabel("Recencia en dias")
plt.ylabel("Gasto total")
plt.legend(bbox_to_anchor=(1.05, 1), loc="upper left")
plt.show()
"""),
    md("""
## 8. Acciones por segmento

Traducimos cada grupo a una decision comercial.
"""),
    code("""
actions = {
    "VIP frecuentes": "Beneficio premium y acceso anticipado",
    "Ocasionales": "Recordatorio de proxima visita",
    "Riesgo de fuga": "Promocion de regreso con vigencia corta",
    "Nuevos/prueba": "Seguimiento post-servicio",
}

clients["accion_sugerida"] = clients["segmento"].map(actions)
clients.sort_values(["segmento", "gasto_total"], ascending=[True, False]).head(20)
"""),
    md("""
## 9. Guardado del modelo

Guardamos el escalador, el modelo K-Means y las etiquetas de negocio.
"""),
    code("""
artifact_path = ARTIFACT_DIR / "notebook_client_kmeans_segmentation.joblib"
joblib.dump({"scaler": scaler, "model": kmeans, "labels": labels}, artifact_path)
artifact_path
"""),
]


def main():
    write_notebook("01_clasificacion_no_show.ipynb", "Clasificacion: prediccion de inasistencias", classification_cells)
    write_notebook("02_regresion_ingresos.ipynb", "Regresion: pronostico de ingresos semanales", regression_cells)
    write_notebook("03_clustering_clientes.ipynb", "Clustering: segmentacion de clientes", clustering_cells)
    print(f"Notebooks creadas en {NOTEBOOKS}")


if __name__ == "__main__":
    main()
