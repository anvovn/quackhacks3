import os

from dotenv import load_dotenv

load_dotenv()

SNOWFLAKE_USER = os.getenv("SNOWFLAKE_USER")
SNOWFLAKE_PASSWORD = os.getenv("SNOWFLAKE_PASSWORD")
SNOWFLAKE_ACCOUNT = os.getenv("SNOWFLAKE_ACCOUNT")


def _connect():
    import snowflake.connector
    if not SNOWFLAKE_USER:
        raise RuntimeError("SNOWFLAKE_USER is not set")
    if not SNOWFLAKE_PASSWORD:
        raise RuntimeError("SNOWFLAKE_PASSWORD is not set")
    if not SNOWFLAKE_ACCOUNT:
        raise RuntimeError("SNOWFLAKE_ACCOUNT is not set")
    return snowflake.connector.connect(
        user=SNOWFLAKE_USER,
        password=SNOWFLAKE_PASSWORD,
        account=SNOWFLAKE_ACCOUNT,
    )


def query_snowflake(limit: int = 100) -> list[dict]:
    conn = _connect()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT timestamp, sku_id, sku_name, days_left, reasoning, email_draft, status "
            "FROM CHAINAGENT.PUBLIC.agent_actions "
            "ORDER BY timestamp DESC LIMIT %s",
            (limit,)
        )
        cols = [d[0].lower() for d in cursor.description]
        return [dict(zip(cols, row)) for row in cursor.fetchall()]
    finally:
        cursor.close()
        conn.close()


def log_snowflake(sku, reasoning, email, days):
    import snowflake.connector

    if not SNOWFLAKE_USER:
        raise RuntimeError("SNOWFLAKE_USER is not set")
    if not SNOWFLAKE_PASSWORD:
        raise RuntimeError("SNOWFLAKE_PASSWORD is not set")
    if not SNOWFLAKE_ACCOUNT:
        raise RuntimeError("SNOWFLAKE_ACCOUNT is not set")

    conn = _connect()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO CHAINAGENT.PUBLIC.agent_actions (timestamp, sku_id, sku_name, days_left, reasoning, email_draft, status) VALUES (CURRENT_TIMESTAMP, %s, %s, %s, %s, %s, 'pending')",
            (sku["id"], sku["name"], days, reasoning, email)
        )
        conn.commit()
    finally:
        cursor.close()
        conn.close()
