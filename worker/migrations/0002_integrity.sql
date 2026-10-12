CREATE TRIGGER prevent_merged_admission BEFORE INSERT ON jobs BEGIN
 SELECT RAISE(ABORT,'principal_unavailable') WHERE EXISTS(SELECT 1 FROM principals WHERE id=NEW.owner AND (merged_into IS NOT NULL OR review=1));
END;
CREATE TRIGGER prevent_active_link BEFORE UPDATE OF merged_into,google_sub ON principals BEGIN
 SELECT RAISE(ABORT,'active_job') WHERE EXISTS(SELECT 1 FROM jobs WHERE owner=NEW.id AND status IN ('queued','researching','captioning','imaging'));
END;
CREATE TRIGGER prevent_reservation_reopen BEFORE UPDATE OF state ON reservations WHEN OLD.state!='reserved' AND NEW.state!=OLD.state BEGIN
 SELECT RAISE(ABORT,'reservation_is_terminal');
END;
