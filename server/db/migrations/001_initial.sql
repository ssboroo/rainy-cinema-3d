-- PostgreSQL 16+ | RAINY CINEMA 3D initial schema
CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 120),
  slug text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  email text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('OWNER','ADMIN','OPERATOR','VIEWER')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX users_tenant_email_lower_uq ON users (tenant_id, lower(email));

CREATE TABLE cinemas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Ulaanbaatar',
  currency char(3) NOT NULL DEFAULT 'MNT',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE auditoriums (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  cinema_id uuid NOT NULL,
  name text NOT NULL,
  layout_version integer NOT NULL DEFAULT 1 CHECK (layout_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, cinema_id) REFERENCES cinemas(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  auditorium_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[A-Z]{1,3}[0-9]{1,3}$'),
  row_label text NOT NULL,
  seat_number integer NOT NULL CHECK (seat_number > 0),
  seat_type text NOT NULL DEFAULT 'STANDARD' CHECK (seat_type IN ('STANDARD','VIP','ACCESSIBLE','LOVE')),
  x numeric(8,3) NOT NULL DEFAULT 0,
  z numeric(8,3) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, auditorium_id, code),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, auditorium_id) REFERENCES auditoriums(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE showtimes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  cinema_id uuid NOT NULL,
  auditorium_id uuid NOT NULL,
  movie_title text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','ON_SALE','CANCELLED','COMPLETED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, cinema_id) REFERENCES cinemas(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, auditorium_id) REFERENCES auditoriums(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX showtimes_tenant_start_idx ON showtimes(tenant_id, starts_at);

CREATE TABLE seat_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  showtime_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED','RELEASED','CONVERTED')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, showtime_id) REFERENCES showtimes(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX seat_holds_expiry_idx ON seat_holds(expires_at) WHERE status = 'ACTIVE';

CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  showtime_id uuid NOT NULL,
  user_id uuid NOT NULL,
  hold_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'PENDING_PAYMENT' CHECK (status IN ('PENDING_PAYMENT','PAYMENT_FAILED','CONFIRMED','CANCELLED','REFUNDED')),
  total_amount bigint NOT NULL CHECK (total_amount >= 0),
  currency char(3) NOT NULL DEFAULT 'MNT',
  payment_provider text,
  provider_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, hold_id),
  FOREIGN KEY (tenant_id, showtime_id) REFERENCES showtimes(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, hold_id) REFERENCES seat_holds(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX bookings_tenant_created_idx ON bookings(tenant_id, created_at DESC);

CREATE TABLE showtime_seats (
  tenant_id uuid NOT NULL,
  showtime_id uuid NOT NULL,
  seat_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','HELD','SOLD','BLOCKED')),
  price_amount bigint NOT NULL CHECK (price_amount >= 0),
  hold_id uuid,
  booking_id uuid,
  hold_expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, showtime_id, seat_id),
  FOREIGN KEY (tenant_id, showtime_id) REFERENCES showtimes(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, seat_id) REFERENCES seats(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, hold_id) REFERENCES seat_holds(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, booking_id) REFERENCES bookings(tenant_id, id) ON DELETE RESTRICT,
  CHECK ((status = 'HELD' AND hold_id IS NOT NULL AND hold_expires_at IS NOT NULL) OR (status <> 'HELD' AND hold_id IS NULL AND hold_expires_at IS NULL)),
  CHECK ((status = 'SOLD' AND booking_id IS NOT NULL) OR (status <> 'SOLD' AND booking_id IS NULL))
);
CREATE INDEX showtime_seats_status_idx ON showtime_seats(tenant_id, showtime_id, status);

CREATE TABLE booking_seats (
  tenant_id uuid NOT NULL,
  booking_id uuid NOT NULL,
  showtime_id uuid NOT NULL,
  seat_id uuid NOT NULL,
  price_amount bigint NOT NULL CHECK (price_amount >= 0),
  PRIMARY KEY (tenant_id, booking_id, seat_id),
  FOREIGN KEY (tenant_id, booking_id) REFERENCES bookings(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, showtime_id, seat_id) REFERENCES showtime_seats(tenant_id, showtime_id, seat_id) ON DELETE RESTRICT
);

CREATE TABLE idempotency_keys (
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_hash char(64) NOT NULL,
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, user_id, idempotency_key),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX idempotency_expiry_idx ON idempotency_keys(expires_at);

CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  actor_user_id uuid,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_tenant_created_idx ON audit_logs(tenant_id, created_at DESC);

-- Every request must scope queries by tenant_id from a verified JWT claim.
-- Never trust a tenant ID supplied by a browser request body or query string.
