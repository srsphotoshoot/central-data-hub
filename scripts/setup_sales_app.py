import sys
import os

cdh_path = "/Users/romitaggarwal/Desktop/AI/central data hub"
sys.path.append(cdh_path)

from database import SessionLocal, APIKey, MappingRule, init_db

def setup():
    db = SessionLocal()
    init_db()
    
    # 1. Register API Key
    key_val = "cdh_sales_app_key_2026"
    existing_key = db.query(APIKey).filter(APIKey.key == key_val).first()
    if not existing_key:
        new_key = APIKey(
            key=key_val,
            project_name="Sales App",
            scope=["products", "sales", "logs"],
            is_active=True
        )
        db.add(new_key)
        print(f"✅ API Key registered: {key_val}")
    else:
        print("ℹ️ API Key already exists.")

    # 2. Register Mapping Rule for Webhooks
    source = "sales_app"
    existing_rule = db.query(MappingRule).filter(MappingRule.source == source, MappingRule.target_category == "sales").first()
    if not existing_rule:
        new_rule = MappingRule(
            source=source,
            target_category="sales",
            field_mappings={
                "orderId": "orderId",
                "customer": "customer",
                "cart": "cart",
                "totalValue": "totalValue"
            },
            is_active=True
        )
        db.add(new_rule)
        print(f"✅ Mapping Rule registered: {source} -> sales")
    else:
        print("ℹ️ Mapping Rule already exists.")
        
    # 3. Register Mapping Rule for Product Updates
    product_source = "sales_app_products"
    existing_product_rule = db.query(MappingRule).filter(MappingRule.source == product_source, MappingRule.target_category == "products").first()
    if not existing_product_rule:
        new_product_rule = MappingRule(
            source=product_source,
            target_category="products",
            field_mappings={}, # Passthrough
            is_active=True
        )
        db.add(new_product_rule)
        print(f"✅ Mapping Rule registered: {product_source} -> products")
    else:
        print("ℹ️ Product Mapping Rule already exists.")
    db.commit()
    db.close()

if __name__ == "__main__":
    setup()
