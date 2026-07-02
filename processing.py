from database import RawData, ProcessedData, MappingRule, SessionLocal
from dispatcher import dispatch_processed_data
import datetime

def apply_mapping(data: dict, rule: MappingRule):
    """Transform the incoming data based on the mapping rule."""
    if not isinstance(data, dict):
        return data
        
    new_data = {}
    # Use field mapping if it exists
    if rule.field_mappings:
        for src_field, target_field in rule.field_mappings.items():
            if src_field in data:
                new_data[target_field] = data[src_field]
        
        # Keep other fields that aren't mapped
        for k, v in data.items():
            if k not in rule.field_mappings:
                new_data[k] = v
    else:
        new_data = data
        
    return new_data

def process_raw_data():
    """Scan raw data and move it to the processed layer using dynamic rules."""
    db = SessionLocal()
    try:
        # Load active mapping rules
        rules = db.query(MappingRule).filter(MappingRule.is_active == True).all()
        
        # Load only UNPROCESSED raw data
        raw_items = db.query(RawData).filter(RawData.is_processed == False).all()
        
        if not raw_items:
            return 
            
        # Collect items to dispatch after DB session closes
        dispatches = []
        
        for item in raw_items:
            # 1. Find matching rule
            rule = next((r for r in rules if r.source == item.source), None)
            
            category = item.source
            content = item.data
            
            # 2. Apply Rule Transformations
            if rule:
                category = rule.target_category
                content = apply_mapping(item.data, rule)
            
            # Extract entity ID (still a basic heuristic)
            if isinstance(content, dict):
                entity_id = content.get("orderId", content.get("uid", content.get("id", content.get("uuid", f"raw_{item.id}"))))
                # Add source info to content for global dashboard grouping
                content["_source"] = item.source
            else:
                entity_id = f"raw_{item.id}"
                
            # 3. Upsert or Delete from ProcessedData
            existing = db.query(ProcessedData).filter(ProcessedData.entity_id == str(entity_id)).first()
            
            is_delete = isinstance(content, dict) and content.get("_action") == "DELETE"
            
            if is_delete:
                if existing:
                    db.delete(existing)
            else:
                if existing:
                    existing.content = content
                    existing.category = category
                    existing.updated_at = datetime.datetime.utcnow()
                else:
                    new_processed = ProcessedData(
                        category=category,
                        entity_id=str(entity_id),
                        content=content,
                        updated_at=datetime.datetime.utcnow()
                    )
                    db.add(new_processed)
            
            # 4. Mark as processed
            item.is_processed = True
            item.processed_at = datetime.datetime.utcnow()
            
            # 5. Collect for dispatch
            dispatches.append((category, content))
            
        db.commit()
        print(f"✅ Processed {len(raw_items)} new raw records.")
    except Exception as e:
        print(f"❌ Processing failed: {str(e)}")
        db.rollback()
    finally:
        db.close()
        
    # Dispatch after DB connection is returned to pool
    for category, content in dispatches:
        dispatch_processed_data(category, content)

if __name__ == "__main__":
    process_raw_data()
