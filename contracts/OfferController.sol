// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { IOfferController } from "./interfaces/IOfferController.sol";
import { Signatures } from "./Signatures.sol";

import { Lien, LoanOffer, BorrowOffer, MarketOffer } from "./Structs.sol";
import { OfferExpired, InvalidLoanAmount, InsufficientOffer, OfferUnavailable, BidCannotBorrow } from "./Errors.sol";

/**
 * @title Kettle Offer Controller
 * @author diamondjim.eth
 * @notice Verifies if loan, borrow, and market offers are takeable
 */
contract OfferController is IOfferController, Signatures {

    mapping(address => mapping(uint256 => uint256)) public cancelledOrFulfilled;
    mapping(bytes32 => uint256) private _amountTaken;
   
    uint256[50] private _gap;

    constructor() Signatures() {}

    function amountTaken(_hash) public returns (uint256) {
        return _amountTaken[_hash];
    }

    /**
     * @dev Internal function to process and validate the acceptance of a loan offer for a specific lien.
     *
     * @param lienId Unique identifier of the lien associated with the loan offer.
     * @param offer Loan offer details to validate and process.
     * @param lien Lien details associated with the offer.
     * @param signature Signature to validate the authenticity of the loan offer.
     *
     * Requirements:
     * - The offer must be validated using its hash, lender, expiration, salt, and the provided signature.
     * - The principal amount of the lien must be within the specified range in the offer.
     * - There must be sufficient amount left in the offer to cover the lien's principal.
     *
     * @dev throws InvalidLoanAmount if the principal amount of the lien is outside the specified range in the offer.
     * @dev throws InsufficientOffer if there is not enough amount left in the offer to cover the lien's principal.
     */
    function _takeLoanOffer(
        uint256 lienId,
        LoanOffer calldata offer,
        Lien memory lien,
        bytes calldata signature
    ) internal {
        
        bytes32 _offerHash = _hashLoanOffer(offer);
        _validateOffer(_offerHash, offer.lender, offer.expiration, offer.salt, signature);

        // check if amount is outside of range
        if (
            lien.principal > offer.terms.maxAmount ||
            lien.principal < offer.terms.minAmount
        ) {
            revert InvalidLoanAmount();
        }

        // check if there is sufficient amount left in the offer
        uint256 __amountTaken = _amountTaken[_offerHash];
        if (offer.terms.totalAmount - __amountTaken < lien.principal) {
            revert InsufficientOffer();
        }

        // update amount taken by specific loan offer
        unchecked {
            _amountTaken[_offerHash] = __amountTaken + lien.principal;
        }

        emit LoanOfferTaken(lienId, msg.sender, _offerHash);
    }

    /**
     * @dev Internal function to process and validate the acceptance of a borrow offer for a specific lien.
     *
     * @param lienId Unique identifier of the lien associated with the borrow offer.
     * @param offer Borrow offer details to validate and process.
     * @param signature Signature to validate the authenticity of the borrow offer.
     *
     * Requirements:
     * - The offer must be validated using its hash, borrower, expiration, salt, and the provided signature.
     * - Mark the borrow offer as taken by updating the storage to indicate it has been fulfilled or cancelled.
     */
    function _takeBorrowOffer(
        uint256 lienId,
        BorrowOffer calldata offer,
        bytes calldata signature
    ) internal {
        
        bytes32 _offerHash = _hashBorrowOffer(offer);
        _validateOffer(_offerHash, offer.borrower, offer.expiration, offer.salt, signature);


        // mark offer as taken
        cancelledOrFulfilled[offer.borrower][offer.salt] = 1;

        emit BorrowOfferTaken(lienId, msg.sender, _offerHash);
    }

    /**
     * @dev Internal function to process and validate the acceptance of a market offer.
     *
     * @param offer Market offer details to validate and process.
     * @param signature Signature to validate the authenticity of the market offer.
     *
     * Requirements:
     * - The offer must be validated using its hash, maker, expiration, salt, and the provided signature.
     * - If the market offer involves a loan (withLoan is true), the amount must be greater than or equal to the borrowAmount.
     * - Mark the market offer as taken by updating the storage to indicate it has been fulfilled or cancelled.
     *
     * @dev throws BidCannotBorrow if the market offer involves a loan and the amount is less than the borrowAmount.
     */
    function _takeMarketOffer(
        MarketOffer calldata offer,
        bytes calldata signature
    ) internal {

        bytes32 _offerHash = _hashMarketOffer(offer);
        _validateOffer(_offerHash, offer.maker, offer.expiration, offer.salt, signature);

        if (offer.terms.withLoan) {
            if (offer.terms.amount < offer.terms.borrowAmount) {
                revert BidCannotBorrow();
            }
        }

        // mark offer as taken
        cancelledOrFulfilled[offer.maker][offer.salt] = 1;

        emit MarketOfferTaken(msg.sender, _hashMarketOffer(offer));
    }

    /**
     * @dev Internal function to validate the authenticity and status of an offer.
     *
     * @param offerHash Hash of the offer being validated.
     * @param signer Address of the signer of the offer.
     * @param expiration Expiration timestamp of the offer.
     * @param salt Unique salt value of the offer.
     * @param signature Signature to validate the authenticity of the offer.
     *
     * Requirements:
     * - The offer's authenticity must be verified by checking the signature against the signer's address.
     * - The offer must not have expired (expiration must be greater than the current block timestamp).
     * - The offer must not have been previously cancelled or fulfilled.
     *
     * @dev throws OfferExpired if the offer has expired.
     * @dev throws OfferUnavailable if the offer has already been cancelled or fulfilled.
     */
    function _validateOffer(
        bytes32 offerHash,
        address signer,
        uint256 expiration,
        uint256 salt,
        bytes calldata signature
    ) internal view {
        _verifyOfferAuthorization(offerHash, signer, signature);

        if (expiration < block.timestamp) {
            revert OfferExpired();
        }
        if (cancelledOrFulfilled[signer][salt] == 1) {
            revert OfferUnavailable();
        }
    }

    /** 
     * @notice Cancels offer salt for caller
     * @param salt Unique offer salt
    */
    function cancelOffer(uint256 salt) external {
        _cancelOffer(msg.sender, salt);
    }

    /**
     * @notice Cancels offers in bulk for caller
     * @param salts List of offer salts
     */
    function cancelOffers(uint256[] calldata salts) external {
        uint256 saltsLength = salts.length;
        for (uint256 i; i < saltsLength; ) {
            _cancelOffer(msg.sender, salts[i]);
            unchecked {
                ++i;
            }
        }
    }

    /// @notice Cancels all offers by incrementing caller nonce
    function incrementNonce() external {
        _incrementNonce(msg.sender);
    }

    /**
     * @dev Cancel offer by user and salt
     * @param user Address of user
     * @param salt Unique offer salt
     */
    function _cancelOffer(address user, uint256 salt) private {
        cancelledOrFulfilled[user][salt] = 1;
        emit OfferCancelled(user, salt);
    }

    /**
     * @dev Cancel all orders by incrementing the user nonce
     * @param user Address of user
     */
    function _incrementNonce(address user) internal {
        emit NonceIncremented(user, ++nonces[user]);
    }
}
