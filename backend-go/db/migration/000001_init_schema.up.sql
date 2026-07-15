-- Habilitar extensión UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Usuarios y Seguridad (Auth)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'vendedor' CHECK (role IN ('admin', 'vendedor', 'disenador', 'carpintero')),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Registro de Clientes
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    notes TEXT,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Catálogo: Tableros
CREATE TABLE IF NOT EXISTS material_boards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    width_mm INT NOT NULL CHECK (width_mm > 0),
    length_mm INT NOT NULL CHECK (length_mm > 0),
    thickness_mm INT NOT NULL CHECK (thickness_mm > 0),
    board_price NUMERIC(12, 2) NOT NULL CHECK (board_price >= 0),
    waste_percent NUMERIC(5, 2) NOT NULL DEFAULT 0.00 CHECK (waste_percent >= 0),
    cost_per_m2 NUMERIC(12, 2) GENERATED ALWAYS AS (
        (board_price / ((width_mm::numeric * length_mm::numeric) / 1000000.0)) * (1.0 + waste_percent / 100.0)
    ) STORED,
    notes TEXT,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Catálogo: Cantos (Cintillas)
CREATE TABLE IF NOT EXISTS edge_bands (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    thickness_mm INT NOT NULL CHECK (thickness_mm > 0),
    cost_per_ml NUMERIC(12, 2) NOT NULL CHECK (cost_per_ml >= 0),
    notes TEXT,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Catálogo: Herrajes
CREATE TABLE IF NOT EXISTS hardwares (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    unit VARCHAR(20) NOT NULL CHECK (unit IN ('piece', 'set', 'meter')),
    cost_per_unit NUMERIC(12, 2) NOT NULL CHECK (cost_per_unit >= 0),
    notes TEXT,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Catálogo: Grupos de Opciones
CREATE TABLE IF NOT EXISTS option_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('board', 'hardware', 'edge')),
    required BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS option_group_members (
    option_group_id UUID REFERENCES option_groups(id) ON DELETE CASCADE,
    entity_id UUID NOT NULL,
    PRIMARY KEY (option_group_id, entity_id)
);

-- 7. Categorías jerárquicas de módulos (máx 3 niveles en app)
CREATE TABLE IF NOT EXISTS module_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    parent_id UUID REFERENCES module_categories(id) ON DELETE RESTRICT,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. Catálogo: Módulos Plantilla
CREATE TABLE IF NOT EXISTS modules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    base_labor_cost NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (base_labor_cost >= 0),
    width_mm INT,
    height_mm INT,
    depth_mm INT,
    category_id UUID REFERENCES module_categories(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS board_parts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    module_id UUID REFERENCES modules(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    description VARCHAR(255) NOT NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    length_mm INT NOT NULL CHECK (length_mm > 0),
    width_mm INT NOT NULL CHECK (width_mm > 0),
    grain INT NOT NULL CHECK (grain IN (0, 1)),
    option_role VARCHAR(50) NOT NULL,
    edge_l1 BOOLEAN NOT NULL DEFAULT false,
    edge_l2 BOOLEAN NOT NULL DEFAULT false,
    edge_w1 BOOLEAN NOT NULL DEFAULT false,
    edge_w2 BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS hardware_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    module_id UUID REFERENCES modules(id) ON DELETE CASCADE,
    quantity INT NOT NULL CHECK (quantity > 0),
    description_override VARCHAR(255),
    option_role VARCHAR(50) NOT NULL,
    hardware_id UUID REFERENCES hardwares(id) ON DELETE SET NULL
);

-- 9. Cotizaciones y Proyectos
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'MXN',
    margin_factor NUMERIC(5, 2) NOT NULL DEFAULT 1.00 CHECK (margin_factor > 0),
    labor_fixed_cost NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (labor_fixed_cost >= 0),
    status VARCHAR(20) NOT NULL CHECK (status IN ('draft', 'quoted', 'accepted')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    module_id UUID REFERENCES modules(id) NOT NULL,
    quantity INT NOT NULL CHECK (quantity > 0)
);

CREATE TABLE IF NOT EXISTS project_item_choices (
    project_item_id UUID REFERENCES project_items(id) ON DELETE CASCADE,
    option_group_code VARCHAR(50) NOT NULL,
    choice_entity_id UUID NOT NULL,
    PRIMARY KEY (project_item_id, option_group_code)
);

-- 10. Snapshots de Costos
CREATE TABLE IF NOT EXISTS quote_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
    captured_at TIMESTAMP WITH TIME ZONE NOT NULL,
    materials_cost NUMERIC(12, 2) NOT NULL,
    edge_total NUMERIC(12, 2) NOT NULL,
    hardware_total NUMERIC(12, 2) NOT NULL,
    direct_cost NUMERIC(12, 2) NOT NULL,
    labor_modular NUMERIC(12, 2) NOT NULL,
    labor_fixed_cost NUMERIC(12, 2) NOT NULL,
    margin_factor NUMERIC(5, 2) NOT NULL,
    sale_price NUMERIC(12, 2) NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshot_prices (
    snapshot_id UUID REFERENCES quote_snapshots(id) ON DELETE CASCADE,
    entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('material', 'edge', 'hardware')),
    entity_id UUID NOT NULL,
    cost_value NUMERIC(12, 2) NOT NULL,
    PRIMARY KEY (snapshot_id, entity_type, entity_id)
);
