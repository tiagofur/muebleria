CREATE TABLE IF NOT EXISTS warranty_tickets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticket_number VARCHAR(30) UNIQUE NOT NULL,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category VARCHAR(50) NOT NULL DEFAULT 'other',
    priority VARCHAR(20) NOT NULL DEFAULT 'normal',
    status VARCHAR(30) NOT NULL DEFAULT 'open',
    assigned_technician_id UUID REFERENCES users(id) ON DELETE SET NULL,
    scheduled_date DATE,
    resolved_at TIMESTAMPTZ,
    resolution_notes TEXT,
    refabrication_pieces JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_warranty_tickets_project_id ON warranty_tickets(project_id);
CREATE INDEX IF NOT EXISTS idx_warranty_tickets_customer_id ON warranty_tickets(customer_id);
CREATE INDEX IF NOT EXISTS idx_warranty_tickets_status ON warranty_tickets(status);

CREATE TABLE IF NOT EXISTS warranty_ticket_photos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    ticket_id UUID NOT NULL REFERENCES warranty_tickets(id) ON DELETE CASCADE,
    kind VARCHAR(30) NOT NULL DEFAULT 'issue_report',
    url VARCHAR(500) NOT NULL,
    thumbnail_url VARCHAR(500) NOT NULL,
    caption TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_warranty_ticket_photos_ticket_id ON warranty_ticket_photos(ticket_id);
