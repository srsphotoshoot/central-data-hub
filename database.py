import os
from sqlalchemy import create_engine, Column, Integer, String, JSON, DateTime, Boolean, Float
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import datetime
from dotenv import load_dotenv

load_dotenv()

# Database configuration driven by environment variables for cloud readiness
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:////Users/romitaggarwal/Desktop/AI/central data hub/central_hub.db")

# Connection pooling for high-concurrency cloud environments
is_sqlite = "sqlite" in DATABASE_URL
connect_args = {"check_same_thread": False} if is_sqlite else {}

kwargs = {}
if not is_sqlite:
    kwargs["pool_size"] = 5
    kwargs["max_overflow"] = 10

engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    **kwargs
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

class RawData(Base):
    __tablename__ = "raw_data"
    id = Column(Integer, primary_key=True, index=True)
    source = Column(String)  # e.g., 'decent_erp'
    endpoint = Column(String)
    method = Column(String, default="GET")  # GET, POST, WEBHOOK
    headers = Column(JSON, nullable=True)
    data = Column(JSON, nullable=True)
    received_at = Column(DateTime, default=datetime.datetime.utcnow)
    is_processed = Column(Boolean, default=False)
    processed_at = Column(DateTime, nullable=True)

class ProcessedData(Base):
    __tablename__ = "processed_data"
    id = Column(Integer, primary_key=True, index=True)
    category = Column(String)  # e.g., 'sales', 'inventory'
    entity_id = Column(String, index=True)  # Unique identifier from the source
    content = Column(JSON)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow)

class APIKey(Base):
    __tablename__ = "api_keys"
    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, unique=True, index=True)
    project_name = Column(String)
    scope = Column(JSON, nullable=True)
    callback_url = Column(String, nullable=True) # For outbound webhooks
    is_active = Column(Boolean, default=True)

class MappingRule(Base):
    __tablename__ = "mapping_rules"
    id = Column(Integer, primary_key=True, index=True)
    source = Column(String)  # e.g., 'decent_erp'
    target_category = Column(String)
    field_mappings = Column(JSON) # e.g., {"decent_field": "hub_field"}
    is_active = Column(Boolean, default=True)

class GatepassEntry(Base):
    __tablename__ = "gatepass_entries"
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(String, nullable=True)
    type = Column(String, nullable=True)
    status = Column(String, default="pending")
    cdh_verified = Column(Boolean, default=False)
    date = Column(String, nullable=True)
    challanNo = Column(String, nullable=True)
    partyName = Column(String, nullable=True)
    designNo = Column(String, nullable=True)
    description = Column(String, nullable=True)
    quantity = Column(String, nullable=True)
    unitType = Column(String, default="pcs")
    orderNo = Column(String, nullable=True)
    transportName = Column(String, nullable=True)
    biltyNo = Column(String, nullable=True)
    dept = Column(String, nullable=True)
    parcelFrom = Column(String, nullable=True)
    initiatedBy = Column(String, nullable=True)
    guardHoldReason = Column(String, nullable=True)
    guardNotes = Column(String, nullable=True)
    meta = Column(String, nullable=True)

class CatalogProduct(Base):
    __tablename__ = "catalog_products"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    category = Column(String, nullable=True)
    fabric = Column(String, nullable=True)
    hsn_code = Column(String, nullable=True)
    gst_rate = Column(Float, default=5.0)
    cost_price = Column(Float, default=0.0)
    price = Column(Float, default=0.0)
    mrp = Column(Float, default=0.0)
    sizes = Column(JSON, default=[]) # e.g. ["S", "M", "L"]
    status = Column(String, default="Active")
    image_url = Column(String, nullable=True)
    crm_tags = Column(JSON, default=[]) # Stores tags as a JSON array
    variants = Column(JSON, default=[]) # Stores color variants and AI image ids
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


def init_db():
    Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
