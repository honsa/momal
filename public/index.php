<?php

declare(strict_types=1);

// Simple static file front controller for PHP built-in server.
// In production you'd serve /public directly via nginx/apache.

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

if ($path === '/' || $path === '') {
    $path = '/index.html';
}

$file = __DIR__ . $path;

if (is_file($file)) {
    $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
    $types = [
        'html' => 'text/html; charset=utf-8',
        'js' => 'application/javascript; charset=utf-8',
        'css' => 'text/css; charset=utf-8',
        'png' => 'image/png',
        'svg' => 'image/svg+xml',
        'json' => 'application/json; charset=utf-8',
    ];
    if (isset($types[$ext])) {
        header('Content-Type: ' . $types[$ext]);
    }
    readfile($file);
    exit;
}

http_response_code(404);
echo 'Not found';

