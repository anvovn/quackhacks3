from dotenv import load_dotenv

from agent.config import get_key

load_dotenv()


def _connect():
    import snowflake.connector
    user     = get_key("snowflake_user",     "SNOWFLAKE_USER")
    password = get_key("snowflake_password", "SNOWFLAKE_PASSWORD")
    account  = get_key("snowflake_account",  "SNOWFLAKE_ACCOUNT")
    if not user:     raise RuntimeError("SNOWFLAKE_USER is not set")
    if not password: raise RuntimeError("SNOWFLAKE_PASSWORD is not set")
    if not account:  raise RuntimeError("SNOWFLAKE_ACCOUNT is not set")
    return snowflake.connector.connect(user=user, password=password, account=account)


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
