<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
require_method('GET');

$user = current_user();
json_response([
    'csrf' => csrf_token(),
    'authenticated' => (bool) $user,
    'user' => $user ? user_payload($user) : null,
]);
