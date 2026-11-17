"""MongoDB Atlas-backed Store that replaces the SQLite/SQLAlchemy Store.

Provides the same Collection interface (find, find_one, insert_one,
update_one, update_many, delete_one, delete_many, count_documents,
distinct, find_one_and_update, create_index) so app.py and leadership.py
work without changes.
"""
import os
from dotenv import load_dotenv
from pathlib import Path
from pymongo import MongoClient, ASCENDING, DESCENDING, ReturnDocument
from pymongo.errors import DuplicateKeyError
from bson import ObjectId

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

_client = None
_db = None


def get_db():
    global _client, _db
    if _db is None:
        mongo_uri = os.getenv("MONGO_URI", "")
        if not mongo_uri:
            raise RuntimeError("MONGO_URI is not set in .env")
        _client = MongoClient(mongo_uri, serverSelectionTimeoutMS=15000)
        # Extract database name from URI or use default
        path_part = mongo_uri.split("/")[-1].split("?")[0]
        db_name = path_part if path_part else "learnloop"
        _db = _client[db_name]
    return _db


class _Cursor:
    """Lightweight wrapper around a pymongo Cursor that supports chained .sort()."""

    def __init__(self, cursor):
        self._cursor = cursor

    def sort(self, key_or_list, direction=None):
        if direction is not None:
            self._cursor = self._cursor.sort(key_or_list, direction)
        else:
            self._cursor = self._cursor.sort(key_or_list)
        return self

    def skip(self, n):
        self._cursor = self._cursor.skip(n)
        return self

    def limit(self, n):
        self._cursor = self._cursor.limit(n)
        return self

    def __iter__(self):
        return iter(self._cursor)

    def __list__(self):
        return list(self._cursor)


class Collection:
    """Wraps a pymongo Collection with the same interface as the SQLite Collection."""

    def __init__(self, collection):
        self._col = collection

    def find(self, query=None, projection=None, sort=None, skip=0, limit=0):
        query = query or {}
        cursor = self._col.find(query, projection)
        if sort:
            cursor = cursor.sort(sort)
        if skip:
            cursor = cursor.skip(skip)
        if limit:
            cursor = cursor.limit(limit)
        # Return a _Cursor so callers can chain .sort(), .skip(), .limit()
        # AND iterate / list() it directly
        return _Cursor(cursor)

    def find_one(self, query=None, projection=None):
        return self._col.find_one(query or {}, projection)

    def insert_one(self, document):
        if "_id" not in document:
            document["_id"] = ObjectId()
        return self._col.insert_one(document)

    def update_one(self, query, update, upsert=False):
        return self._col.update_one(query, update, upsert=upsert)

    def update_many(self, query, update):
        return self._col.update_many(query, update)

    def delete_one(self, query):
        return self._col.delete_one(query)

    def delete_many(self, query):
        return self._col.delete_many(query)

    def count_documents(self, query=None):
        return self._col.count_documents(query or {})

    def distinct(self, field, query=None):
        return self._col.distinct(field, query or {})

    def find_one_and_update(self, query, update, return_document=ReturnDocument.BEFORE, upsert=False):
        return self._col.find_one_and_update(
            query, update,
            return_document=return_document,
            upsert=upsert,
        )

    def create_index(self, keys, unique=False, **kwargs):
        try:
            self._col.create_index(keys, unique=unique, **kwargs)
        except Exception:
            pass  # Index may already exist

    def aggregate(self, pipeline):
        return list(self._col.aggregate(pipeline))


class Store:
    """Provides attribute access to all CampusHub MongoDB collections."""

    # Map attribute name -> MongoDB collection name
    # Uses the actual collection names present in Atlas
    COLLECTION_MAP = {
        "users": "users",
        "resources": "resources",
        "questions": "questions",
        "announcements": "announcements",
        "notifications": "notifications",
        "contributions": "contributions",
        "resource_ratings": "resource_ratings",
        "badge_achievements": "badge_achievements",
        "leadership_audits": "leadership_audits",
        "assignments": "assignments",
        "assignment_submissions": "assignment_submissions",
    }

    def __init__(self):
        db = get_db()
        for attr, col_name in self.COLLECTION_MAP.items():
            setattr(self, attr, Collection(db[col_name]))
