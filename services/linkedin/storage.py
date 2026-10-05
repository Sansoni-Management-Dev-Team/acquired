"""Encrypted local prototype persistence; no database schema is created."""
import hashlib
import json
import os
from pathlib import Path
from cryptography.fernet import Fernet

class Vault:
    def __init__(self, directory, key):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.cipher = Fernet(key)

    @staticmethod
    def owner(organisation, user):
        return hashlib.sha256(json.dumps([organisation, user]).encode()).hexdigest()

    def load(self, owner):
        path = self.directory / (owner + '.enc')
        return json.loads(self.cipher.decrypt(path.read_bytes())) if path.exists() else {'actions': {}}

    def save(self, owner, data):
        path = self.directory / (owner + '.enc')
        temporary = path.with_suffix('.tmp')
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(self.cipher.encrypt(json.dumps(data).encode()))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory_fd = os.open(self.directory, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)

    def delete(self, owner):
        (self.directory / (owner + '.enc')).unlink(missing_ok=True)
