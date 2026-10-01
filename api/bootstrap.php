<?php
declare(strict_types=1);

error_reporting(E_ALL);
ini_set('display_errors', '0');

if (PHP_SAPI !== 'cli') {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, private');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: same-origin');
    header('X-Frame-Options: DENY');
}

$configPath = dirname(__DIR__, 2) . '/.config/vcgteamlists/config.php';
if (!is_file($configPath)) {
    if (PHP_SAPI === 'cli') {
        fwrite(STDERR, "Runtime configuration is missing.\n");
        exit(1);
    }
    http_response_code(500);
    echo json_encode(['error' => 'Service configuration is unavailable.']);
    exit;
}

/** @var array<string,mixed> $config */
$config = require $configPath;

date_default_timezone_set('UTC');

if (PHP_SAPI !== 'cli') {
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.cookie_httponly', '1');
    ini_set('session.cookie_secure', '1');
    ini_set('session.cookie_samesite', 'Lax');
    ini_set('session.gc_maxlifetime', (string) (60 * 60 * 24 * 7));
    session_name('vcg_session');
    session_set_cookie_params([
        'lifetime' => 60 * 60 * 24 * 7,
        'path' => '/',
        'secure' => true,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

set_exception_handler(function (Throwable $e): void {
    error_log('[vcgteamlists] ' . $e->getMessage() . "\n" . $e->getTraceAsString());
    if (PHP_SAPI === 'cli') {
        fwrite(STDERR, "Unhandled error. Check the PHP error log.\n");
        exit(1);
    }
    json_response(['error' => 'Something went wrong. Please try again.'], 500);
});

function config(string $key, mixed $default = null): mixed {
    global $config;
    return $config[$key] ?? $default;
}

function db(): PDO {
    static $pdo = null;
    if ($pdo instanceof PDO) return $pdo;

    $dsn = 'mysql:host=' . config('db_host') . ';dbname=' . config('db_name') . ';charset=utf8mb4';
    $pdo = new PDO($dsn, (string) config('db_user'), (string) config('db_password'), [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
        PDO::ATTR_STRINGIFY_FETCHES => false,
    ]);
    return $pdo;
}

function json_response(array $data, int $status = 200): never {
    if (PHP_SAPI !== 'cli') http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function require_method(string ...$allowed): void {
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    if (!in_array($method, $allowed, true)) {
        header('Allow: ' . implode(', ', $allowed));
        json_response(['error' => 'Method not allowed.'], 405);
    }
}

function json_body(int $maxBytes = 300000): array {
    $length = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($length > $maxBytes) json_response(['error' => 'Request is too large.'], 413);
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') return [];
    try {
        $data = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        json_response(['error' => 'Invalid JSON.'], 400);
    }
    if (!is_array($data)) json_response(['error' => 'Invalid request body.'], 400);
    return $data;
}

function csrf_token(): string {
    if (empty($_SESSION['csrf']) || !is_string($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

function require_csrf(): void {
    $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!is_string($sent) || $sent === '' || !hash_equals(csrf_token(), $sent)) {
        json_response(['error' => 'Your session has expired. Refresh the page and try again.'], 419);
    }
}

function app_key(): string {
    static $key = null;
    if (is_string($key)) return $key;
    $path = (string) config('app_key_file');
    $value = is_file($path) ? trim((string) file_get_contents($path)) : '';
    if (strlen($value) < 32) throw new RuntimeException('Application key is unavailable.');
    $key = $value;
    return $key;
}

function base_url(): string {
    return rtrim((string) config('base_url', 'https://vcg.pokemonleagueswindon.co.uk'), '/');
}

function normalize_email(string $email): string {
    return strtolower(trim($email));
}

function password_algorithm(): string|int|null {
    return defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT;
}

function validate_password(string $password, string $email = ''): ?string {
    $length = strlen($password);
    if ($length < 12) return 'Use at least 12 characters for your password.';
    if ($length > 128) return 'Password is too long.';
    if ($email !== '') {
        $local = strtolower((string) strstr($email, '@', true));
        if (strlen($local) >= 4 && str_contains(strtolower($password), $local)) {
            return 'Choose a password that does not contain your email name.';
        }
    }
    return null;
}

function request_ip_hash(): string {
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    return hash_hmac('sha256', $ip, app_key());
}

function email_hash(string $email): string {
    return hash_hmac('sha256', normalize_email($email), app_key());
}

function rate_limited(string $scope, string $email, int $limit, int $windowSeconds): bool {
    $cutoff = gmdate('Y-m-d H:i:s', time() - $windowSeconds);
    $stmt = db()->prepare(
        'SELECT COUNT(*) FROM auth_attempts
         WHERE scope = ? AND success = 0 AND created_at >= ?
         AND (email_hash = ? OR ip_hash = ?)'
    );
    $stmt->execute([$scope, $cutoff, email_hash($email), request_ip_hash()]);
    return (int) $stmt->fetchColumn() >= $limit;
}

function record_attempt(string $scope, string $email, bool $success): void {
    $stmt = db()->prepare(
        'INSERT INTO auth_attempts (scope, email_hash, ip_hash, success, created_at)
         VALUES (?, ?, ?, ?, UTC_TIMESTAMP())'
    );
    $stmt->execute([$scope, email_hash($email), request_ip_hash(), $success ? 1 : 0]);

    if (random_int(1, 20) === 1) {
        db()->exec("DELETE FROM auth_attempts WHERE created_at < (UTC_TIMESTAMP() - INTERVAL 2 DAY)");
    }
}

function avatar_url(array $user): string {
    if (($user['avatar_mode'] ?? 'gravatar') === 'custom' && !empty($user['avatar_file'])) {
        $stamp = !empty($user['updated_at']) ? strtotime((string) $user['updated_at']) : time();
        return base_url() . '/api/avatar.php?id=' . rawurlencode((string) $user['id']) . '&v=' . $stamp;
    }
    $hash = md5(normalize_email((string) $user['email']));
    return 'https://www.gravatar.com/avatar/' . $hash . '?s=160&d=identicon&r=pg';
}

function user_payload(array $user): array {
    return [
        'id' => (int) $user['id'],
        'email' => (string) $user['email'],
        'verified' => !empty($user['email_verified_at']),
        'playerName' => (string) ($user['player_name'] ?? ''),
        'trainerName' => (string) ($user['trainer_name'] ?? ''),
        'playerId' => (string) ($user['player_id'] ?? ''),
        'yearOfBirth' => $user['year_of_birth'] !== null ? (int) $user['year_of_birth'] : null,
        'avatarMode' => (string) ($user['avatar_mode'] ?? 'gravatar'),
        'avatarUrl' => avatar_url($user),
    ];
}

function current_user(): ?array {
    if (empty($_SESSION['user_id']) || empty($_SESSION['session_version'])) return null;

    $stmt = db()->prepare('SELECT * FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([(int) $_SESSION['user_id']]);
    $user = $stmt->fetch();
    if (!$user || (int) $user['session_version'] !== (int) $_SESSION['session_version']) {
        unset($_SESSION['user_id'], $_SESSION['session_version']);
        return null;
    }
    return $user;
}

function require_user(): array {
    $user = current_user();
    if (!$user) json_response(['error' => 'Sign in to continue.'], 401);
    return $user;
}

function create_one_time_token(string $table, int $userId, int $ttlSeconds): string {
    if (!in_array($table, ['email_verification_tokens', 'password_reset_tokens'], true)) {
        throw new InvalidArgumentException('Invalid token table.');
    }
    $token = bin2hex(random_bytes(32));
    $hash = hash('sha256', $token);
    $expires = gmdate('Y-m-d H:i:s', time() + $ttlSeconds);

    $pdo = db();
    $pdo->prepare("DELETE FROM {$table} WHERE user_id = ? OR expires_at < UTC_TIMESTAMP()")->execute([$userId]);
    $pdo->prepare("INSERT INTO {$table} (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, UTC_TIMESTAMP())")
        ->execute([$userId, $hash, $expires]);

    return $token;
}

function send_text_email(string $to, string $subject, string $body): bool {
    $from = (string) config('mail_from', 'noreply@pokemonleagueswindon.co.uk');
    $headers = [
        'From: VGC Team Lists <' . $from . '>',
        'Reply-To: ' . $from,
        'Content-Type: text/plain; charset=UTF-8',
        'X-Mailer: VGC Team Lists',
    ];
    return mail($to, $subject, $body, implode("\r\n", $headers));
}

function send_verification_email(array $user): bool {
    $token = create_one_time_token('email_verification_tokens', (int) $user['id'], 86400);
    $link = base_url() . '/api/verify-email.php?token=' . rawurlencode($token);
    $body = "Verify your VGC Team Lists account:\n\n{$link}\n\nThis link expires in 24 hours. If you did not create this account, you can ignore this email.";
    return send_text_email((string) $user['email'], 'Verify your VGC Team Lists account', $body);
}

function send_password_reset_email(array $user): bool {
    $token = create_one_time_token('password_reset_tokens', (int) $user['id'], 1800);
    $link = base_url() . '/?reset=' . rawurlencode($token);
    $body = "Reset your VGC Team Lists password:\n\n{$link}\n\nThis link expires in 30 minutes. If you did not request a reset, you can ignore this email.";
    return send_text_email((string) $user['email'], 'Reset your VGC Team Lists password', $body);
}
