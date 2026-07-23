from __future__ import annotations

import argparse
import json
import os
import random
from datetime import date, datetime, time, timedelta
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import psycopg2
from psycopg2.extras import Json, execute_values
from sklearn.cluster import KMeans
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.metrics import accuracy_score, mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler


ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_DIR = ROOT / "ml" / "artifacts"


def load_env(path: Path) -> dict[str, str]:
    env = {}
    if not path.exists():
        return env

    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def connect():
    env = {**load_env(ROOT / ".env"), **os.environ}
    conn = psycopg2.connect(
        host=env.get("DB_HOST", "localhost"),
        port=int(env.get("DB_PORT", 5432)),
        user=env.get("DB_USER", "postgres"),
        password=env.get("DB_PASSWORD", ""),
        dbname=env.get("DB_NAME", "db_barberia"),
    )
    conn.autocommit = False
    return conn


def fetch_catalogs(conn):
    with conn.cursor() as cur:
        cur.execute("SET search_path TO core, catalogo, admin, public")
        cur.execute("SELECT id, nombre, precio, duracion FROM tbl_servicios WHERE activo = true ORDER BY id")
        servicios = cur.fetchall()
        cur.execute("SELECT id, nombre FROM locales WHERE activo = true ORDER BY id")
        locales = cur.fetchall()
        cur.execute(
            """
            SELECT b.id, COALESCE(u.nombre, 'Barbero ' || b.id::text) AS nombre
            FROM barberos b
            LEFT JOIN usuarios u ON u.id = b.usuario_id
            WHERE b.activo = true
            ORDER BY b.id
            """
        )
        barberos = cur.fetchall()

    if not servicios:
        raise RuntimeError("No hay servicios activos para generar dataset")
    if not locales:
        locales = [(1, "Sucursal principal")]
    if not barberos:
        barberos = [(1, "Barbero disponible")]
    return servicios, locales, barberos


def ensure_schema(conn):
    ddl = """
    CREATE SCHEMA IF NOT EXISTS analitica;

    CREATE TABLE IF NOT EXISTS analitica.ml_citas_dataset (
      id SERIAL PRIMARY KEY,
      cliente_ref INTEGER NOT NULL,
      cliente_nombre TEXT NOT NULL,
      local_id INTEGER,
      local_nombre TEXT NOT NULL,
      servicio_id INTEGER,
      servicio_nombre TEXT NOT NULL,
      barbero_id INTEGER,
      barbero_nombre TEXT NOT NULL,
      fecha DATE NOT NULL,
      hora TIME NOT NULL,
      dia_semana INTEGER NOT NULL,
      semana INTEGER NOT NULL,
      precio NUMERIC(10,2) NOT NULL,
      duracion INTEGER NOT NULL,
      monto_pagado NUMERIC(10,2) NOT NULL,
      estado_cita TEXT NOT NULL,
      recordatorio_enviado BOOLEAN NOT NULL,
      frecuencia_cliente INTEGER NOT NULL,
      recencia_dias INTEGER NOT NULL,
      gasto_total_cliente NUMERIC(10,2) NOT NULL,
      no_show_rate_cliente NUMERIC(5,4) NOT NULL,
      canal TEXT NOT NULL,
      seed_run_id TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS analitica.ml_model_metrics (
      model_key TEXT PRIMARY KEY,
      model_name TEXT NOT NULL,
      algorithm TEXT NOT NULL,
      trained_at TIMESTAMP NOT NULL DEFAULT NOW(),
      samples INTEGER NOT NULL,
      metrics JSONB NOT NULL,
      artifact_path TEXT
    );

    CREATE TABLE IF NOT EXISTS analitica.ml_no_show_predictions (
      id SERIAL PRIMARY KEY,
      cita_dataset_id INTEGER REFERENCES analitica.ml_citas_dataset(id) ON DELETE CASCADE,
      fecha DATE NOT NULL,
      hora TIME NOT NULL,
      cliente_nombre TEXT NOT NULL,
      servicio_nombre TEXT NOT NULL,
      local_nombre TEXT NOT NULL,
      riesgo NUMERIC(5,4) NOT NULL,
      nivel TEXT NOT NULL,
      accion_sugerida TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS analitica.ml_ingresos_predictions (
      id SERIAL PRIMARY KEY,
      local_id INTEGER,
      local_nombre TEXT NOT NULL,
      semana INTEGER NOT NULL,
      fecha_inicio DATE NOT NULL,
      ingreso_proyectado NUMERIC(12,2) NOT NULL,
      ticket_promedio NUMERIC(10,2) NOT NULL,
      ocupacion_esperada NUMERIC(5,2) NOT NULL,
      variacion_pct NUMERIC(7,2) NOT NULL,
      decision TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS analitica.ml_cliente_segments (
      id SERIAL PRIMARY KEY,
      cliente_ref INTEGER NOT NULL,
      cliente_nombre TEXT NOT NULL,
      segmento TEXT NOT NULL,
      frecuencia_90d INTEGER NOT NULL,
      recencia_dias INTEGER NOT NULL,
      gasto_total NUMERIC(10,2) NOT NULL,
      no_show_rate NUMERIC(5,4) NOT NULL,
      accion TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    """
    with conn.cursor() as cur:
        cur.execute(ddl)
    conn.commit()


def generate_dataset(servicios, locales, barberos, rows=1000, seed=42):
    random.seed(seed)
    np.random.seed(seed)
    today = date.today()
    nombres = [
        "Javier", "Daniel", "Luis", "Carlos", "Miguel", "Eduardo", "Oscar", "Ivan",
        "Hector", "Rafael", "Angel", "Marco", "Diego", "Fernando", "Alexis", "Raul",
        "Sergio", "Brayan", "Emiliano", "Ricardo", "Jose", "Arturo", "Mario", "Pablo",
    ]
    apellidos = [
        "Hernandez", "Ruiz", "Moreno", "Vega", "Torres", "Lopez", "Garcia", "Mendez",
        "Cruz", "Santos", "Flores", "Reyes", "Martinez", "Castillo", "Aguilar",
    ]
    cliente_count = max(160, rows // 4)
    clientes = []
    for i in range(1, cliente_count + 1):
        frecuencia = int(np.clip(np.random.poisson(4) + 1, 1, 18))
        recencia = int(np.clip(np.random.gamma(3.0, 18.0), 1, 220))
        gasto = float(np.clip(np.random.gamma(4.5, 180.0), 120, 4800))
        no_show_rate = float(np.clip(np.random.beta(1.6, 7.0), 0.01, 0.72))
        clientes.append(
            {
                "ref": i,
                "nombre": f"{random.choice(nombres)} {random.choice(apellidos)}",
                "frecuencia": frecuencia,
                "recencia": recencia,
                "gasto": gasto,
                "no_show_rate": no_show_rate,
            }
        )

    data = []
    run_id = datetime.now().strftime("%Y%m%d%H%M%S")
    hour_choices = [9, 10, 11, 12, 13, 15, 16, 17, 18, 19]
    channels = ["web", "alexa", "telefono", "walk-in"]

    for _ in range(rows):
        cliente = random.choice(clientes)
        servicio_id, servicio_nombre, precio, duracion = random.choice(servicios)
        local_id, local_nombre = random.choice(locales)
        barbero_id, barbero_nombre = random.choice(barberos)
        offset = random.randint(-210, 21)
        fecha = today + timedelta(days=offset)
        hora_int = random.choice(hour_choices)
        hora = time(hora_int, random.choice([0, 30]))
        dia_semana = fecha.isoweekday()
        semana = fecha.isocalendar().week
        canal = random.choice(channels)
        tarde = 1 if hora_int >= 17 else 0
        fin_semana = 1 if dia_semana >= 6 else 0
        recordatorio = random.random() < 0.68

        risk = (
            0.10
            + cliente["no_show_rate"] * 0.55
            + (0.09 if tarde else 0)
            + (0.07 if fin_semana else 0)
            + (0.08 if cliente["recencia"] > 90 else 0)
            - (0.08 if recordatorio else 0)
            - min(cliente["frecuencia"], 12) * 0.006
        )
        risk = float(np.clip(risk, 0.03, 0.88))

        if fecha > today:
            estado = "pendiente"
        else:
            roll = random.random()
            if roll < risk * 0.70:
                estado = "no_show"
            elif roll < risk:
                estado = "cancelada"
            else:
                estado = "asistio"

        monto = 0 if estado in ("no_show", "cancelada") else float(precio) * random.uniform(0.92, 1.08)
        data.append(
            (
                cliente["ref"],
                cliente["nombre"],
                local_id,
                local_nombre,
                servicio_id,
                servicio_nombre,
                barbero_id,
                barbero_nombre,
                fecha,
                hora,
                dia_semana,
                semana,
                float(precio),
                int(duracion),
                round(monto, 2),
                estado,
                recordatorio,
                cliente["frecuencia"],
                cliente["recencia"],
                round(cliente["gasto"], 2),
                round(cliente["no_show_rate"], 4),
                canal,
                run_id,
            )
        )
    return data


def seed_dataset(conn, rows):
    servicios, locales, barberos = fetch_catalogs(conn)
    data = generate_dataset(servicios, locales, barberos, rows=rows)
    columns = """
      cliente_ref, cliente_nombre, local_id, local_nombre, servicio_id, servicio_nombre,
      barbero_id, barbero_nombre, fecha, hora, dia_semana, semana, precio, duracion,
      monto_pagado, estado_cita, recordatorio_enviado, frecuencia_cliente, recencia_dias,
      gasto_total_cliente, no_show_rate_cliente, canal, seed_run_id
    """
    with conn.cursor() as cur:
        cur.execute("TRUNCATE analitica.ml_citas_dataset RESTART IDENTITY CASCADE")
        execute_values(
            cur,
            f"INSERT INTO analitica.ml_citas_dataset ({columns}) VALUES %s",
            data,
            page_size=250,
        )
    conn.commit()
    return len(data)


def read_dataset(conn):
    return pd.read_sql_query("SELECT * FROM analitica.ml_citas_dataset", conn)


def save_metric(conn, model_key, model_name, algorithm, samples, metrics, artifact_path):
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO analitica.ml_model_metrics
              (model_key, model_name, algorithm, samples, metrics, artifact_path, trained_at)
            VALUES (%s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (model_key)
            DO UPDATE SET
              model_name = EXCLUDED.model_name,
              algorithm = EXCLUDED.algorithm,
              samples = EXCLUDED.samples,
              metrics = EXCLUDED.metrics,
              artifact_path = EXCLUDED.artifact_path,
              trained_at = NOW()
            """,
            (model_key, model_name, algorithm, samples, Json(metrics), str(artifact_path)),
        )


def train_no_show(conn, df):
    train_df = df[df["estado_cita"] != "pendiente"].copy()
    train_df["target"] = train_df["estado_cita"].isin(["no_show", "cancelada"]).astype(int)
    features = [
        "local_nombre", "servicio_nombre", "barbero_nombre", "dia_semana", "semana", "precio",
        "duracion", "recordatorio_enviado", "frecuencia_cliente", "recencia_dias",
        "gasto_total_cliente", "no_show_rate_cliente", "canal",
    ]
    categorical = ["local_nombre", "servicio_nombre", "barbero_nombre", "canal"]
    numeric = [f for f in features if f not in categorical]

    x_train, x_test, y_train, y_test = train_test_split(
        train_df[features],
        train_df["target"],
        test_size=0.25,
        random_state=42,
        stratify=train_df["target"],
    )
    model = Pipeline(
        steps=[
            ("prep", ColumnTransformer([
                ("cat", OneHotEncoder(handle_unknown="ignore"), categorical),
                ("num", StandardScaler(), numeric),
            ])),
            ("model", RandomForestClassifier(n_estimators=140, max_depth=8, random_state=42)),
        ]
    )
    model.fit(x_train, y_train)
    pred = model.predict(x_test)
    probabilities = model.predict_proba(x_test)[:, 1]
    artifact = ARTIFACT_DIR / "no_show_classifier.joblib"
    joblib.dump(model, artifact)

    candidates = df[df["fecha"] >= date.today()].copy()
    if len(candidates) < 10:
        candidates = df.sort_values("fecha", ascending=False).head(60).copy()
    candidates["riesgo"] = model.predict_proba(candidates[features])[:, 1]
    top = candidates.sort_values("riesgo", ascending=False).head(18)

    rows = []
    for item in top.itertuples():
        riesgo = float(item.riesgo)
        nivel = "Alto" if riesgo >= 0.68 else "Medio" if riesgo >= 0.42 else "Bajo"
        accion = "Llamar y enviar recordatorio reforzado" if nivel == "Alto" else "Enviar WhatsApp de confirmacion"
        rows.append(
            (
                int(item.id),
                item.fecha,
                item.hora,
                item.cliente_nombre,
                item.servicio_nombre,
                item.local_nombre,
                round(riesgo, 4),
                nivel,
                accion,
            )
        )

    with conn.cursor() as cur:
        cur.execute("TRUNCATE analitica.ml_no_show_predictions RESTART IDENTITY")
        execute_values(
            cur,
            """
            INSERT INTO analitica.ml_no_show_predictions
              (cita_dataset_id, fecha, hora, cliente_nombre, servicio_nombre, local_nombre, riesgo, nivel, accion_sugerida)
            VALUES %s
            """,
            rows,
        )
    save_metric(
        conn,
        "no-show",
        "Riesgo de inasistencia",
        "RandomForestClassifier",
        len(train_df),
        {"accuracy": round(float(accuracy_score(y_test, pred)), 4), "risk_mean": round(float(np.mean(probabilities)), 4)},
        artifact,
    )


def train_income(conn, df):
    history = df[(df["fecha"] <= date.today()) & (df["estado_cita"] == "asistio")].copy()
    weekly = (
        history.groupby(["local_id", "local_nombre", "semana"], as_index=False)
        .agg(
            ingreso=("monto_pagado", "sum"),
            citas=("id", "count"),
            clientes=("cliente_ref", "nunique"),
            ticket=("monto_pagado", "mean"),
            duracion=("duracion", "mean"),
        )
        .sort_values(["local_id", "semana"])
    )
    if len(weekly) < 8:
        return
    weekly["ocupacion"] = np.clip(weekly["citas"] / 95.0, 0.15, 1.0)
    features = ["local_id", "semana", "citas", "clientes", "ticket", "ocupacion", "duracion"]
    x_train, x_test, y_train, y_test = train_test_split(weekly[features], weekly["ingreso"], test_size=0.25, random_state=42)
    model = RandomForestRegressor(n_estimators=160, max_depth=7, random_state=42)
    model.fit(x_train, y_train)
    pred = model.predict(x_test)
    artifact = ARTIFACT_DIR / "income_regressor.joblib"
    joblib.dump(model, artifact)

    rows = []
    start = date.today() + timedelta(days=(7 - date.today().weekday()))
    for (local_id, local_nombre), group in weekly.groupby(["local_id", "local_nombre"]):
        base = group.tail(4).mean(numeric_only=True)
        previous_income = float(group.tail(1)["ingreso"].iloc[0])
        for i in range(4):
            week_start = start + timedelta(days=i * 7)
            iso_week = int(week_start.isocalendar().week)
            sample = pd.DataFrame([{
                "local_id": local_id,
                "semana": iso_week,
                "citas": max(15, base["citas"] * (1 + 0.04 * i)),
                "clientes": max(10, base["clientes"] * (1 + 0.03 * i)),
                "ticket": max(120, base["ticket"] * (1 + 0.015 * i)),
                "ocupacion": float(np.clip(base["ocupacion"] + 0.03 * i, 0.20, 0.96)),
                "duracion": base["duracion"],
            }])
            income = float(model.predict(sample[features])[0])
            variation = ((income - previous_income) / previous_income * 100) if previous_income else 0
            decision = "Reforzar turno tarde" if sample["ocupacion"].iloc[0] > 0.75 else "Impulsar paquetes premium"
            rows.append((local_id, local_nombre, iso_week, week_start, round(income, 2), round(float(sample["ticket"].iloc[0]), 2), round(float(sample["ocupacion"].iloc[0]) * 100, 2), round(variation, 2), decision))

    with conn.cursor() as cur:
        cur.execute("TRUNCATE analitica.ml_ingresos_predictions RESTART IDENTITY")
        execute_values(
            cur,
            """
            INSERT INTO analitica.ml_ingresos_predictions
              (local_id, local_nombre, semana, fecha_inicio, ingreso_proyectado, ticket_promedio, ocupacion_esperada, variacion_pct, decision)
            VALUES %s
            """,
            rows,
        )
    save_metric(
        conn,
        "ingresos",
        "Pronostico de ingresos",
        "RandomForestRegressor",
        len(weekly),
        {"mae": round(float(mean_absolute_error(y_test, pred)), 2), "r2": round(float(r2_score(y_test, pred)), 4)},
        artifact,
    )


def train_segments(conn, df):
    clients = (
        df.groupby(["cliente_ref", "cliente_nombre"], as_index=False)
        .agg(
            frecuencia_90d=("frecuencia_cliente", "max"),
            recencia_dias=("recencia_dias", "min"),
            gasto_total=("gasto_total_cliente", "max"),
            no_show_rate=("no_show_rate_cliente", "max"),
        )
    )
    features = ["frecuencia_90d", "recencia_dias", "gasto_total", "no_show_rate"]
    scaler = StandardScaler()
    x = scaler.fit_transform(clients[features])
    kmeans = KMeans(n_clusters=4, random_state=42, n_init=12)
    clients["cluster"] = kmeans.fit_predict(x)

    cluster_stats = clients.groupby("cluster")[features].mean()
    labels = {}
    used = set()

    vip = cluster_stats.sort_values(["gasto_total", "frecuencia_90d"], ascending=False).index[0]
    labels[vip] = ("VIP frecuentes", "Beneficio premium", "#16A34A")
    used.add(vip)

    risk = cluster_stats.drop(index=list(used)).sort_values(["recencia_dias", "no_show_rate"], ascending=False).index[0]
    labels[risk] = ("Riesgo de fuga", "Promocion de regreso", "#DC2626")
    used.add(risk)

    new = cluster_stats.drop(index=list(used)).sort_values("frecuencia_90d", ascending=True).index[0]
    labels[new] = ("Nuevos/prueba", "Seguimiento post-servicio", "#D97706")
    used.add(new)

    for cluster in cluster_stats.index:
        if cluster not in labels:
            labels[cluster] = ("Ocasionales", "Recordatorio de proxima visita", "#0EA5E9")

    clients[["segmento", "accion", "color"]] = clients["cluster"].apply(lambda c: pd.Series(labels[c]))
    artifact = ARTIFACT_DIR / "client_segmentation.joblib"
    joblib.dump({"scaler": scaler, "model": kmeans, "labels": labels}, artifact)

    rows = [
        (
            int(row.cliente_ref),
            row.cliente_nombre,
            row.segmento,
            int(row.frecuencia_90d),
            int(row.recencia_dias),
            round(float(row.gasto_total), 2),
            round(float(row.no_show_rate), 4),
            row.accion,
            row.color,
        )
        for row in clients.itertuples()
    ]
    with conn.cursor() as cur:
        cur.execute("TRUNCATE analitica.ml_cliente_segments RESTART IDENTITY")
        execute_values(
            cur,
            """
            INSERT INTO analitica.ml_cliente_segments
              (cliente_ref, cliente_nombre, segmento, frecuencia_90d, recencia_dias, gasto_total, no_show_rate, accion, color)
            VALUES %s
            """,
            rows,
            page_size=250,
        )
    counts = clients["segmento"].value_counts().to_dict()
    save_metric(
        conn,
        "segmentacion",
        "Segmentacion de clientes",
        "KMeans",
        len(clients),
        {"clusters": 4, "segment_counts": counts},
        artifact,
    )


def train_all(conn):
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    df = read_dataset(conn)
    if len(df) < 200:
        raise RuntimeError("Se requieren al menos 200 registros para entrenar")
    train_no_show(conn, df)
    train_income(conn, df)
    train_segments(conn, df)
    conn.commit()


def main():
    parser = argparse.ArgumentParser(description="Seed and train Barberia Carlyn analytics models")
    parser.add_argument("--rows", type=int, default=1000, help="Synthetic records to create")
    parser.add_argument("--train-only", action="store_true", help="Do not recreate dataset")
    parser.add_argument("--seed-only", action="store_true", help="Only recreate dataset")
    args = parser.parse_args()

    conn = connect()
    try:
        ensure_schema(conn)
        inserted = None
        if not args.train_only:
            inserted = seed_dataset(conn, args.rows)
            print(json.dumps({"seeded_records": inserted}))
        if not args.seed_only:
            train_all(conn)
            print(json.dumps({"trained": ["no-show", "ingresos", "segmentacion"]}))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
