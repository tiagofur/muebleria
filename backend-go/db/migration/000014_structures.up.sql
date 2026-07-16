-- F049 / #99: engineering Structure (cuerpo) bodies — reusable board-part templates.
-- Not linked to modules yet (composition lands in H07).

CREATE TABLE IF NOT EXISTS structures (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    width_mm INT,
    height_mm INT,
    depth_mm INT,
    notes TEXT,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS structure_board_parts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    structure_id UUID NOT NULL REFERENCES structures(id) ON DELETE CASCADE,
    code VARCHAR(50),
    description VARCHAR(255) NOT NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    length_mm INT NOT NULL CHECK (length_mm > 0),
    width_mm INT NOT NULL CHECK (width_mm > 0),
    option_role VARCHAR(50) NOT NULL,
    edge_l1 BOOLEAN NOT NULL DEFAULT false,
    edge_l2 BOOLEAN NOT NULL DEFAULT false,
    edge_w1 BOOLEAN NOT NULL DEFAULT false,
    edge_w2 BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_structure_board_parts_structure_id
    ON structure_board_parts(structure_id);
