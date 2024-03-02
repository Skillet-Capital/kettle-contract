// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { ERC721 } from "solmate/src/tokens/ERC721.sol";

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

import { LoanOffer, BorrowOffer, Lien, LienState, LienStatus, MarketOffer, Side, Criteria } from "./Structs.sol";
import { InvalidLien, LienDefaulted, LienIsCurrent, Unauthorized, MakerIsNotBorrower, InsufficientAskAmount, OnlyBorrower, OfferNotAsk, OfferNotBid, BidNotWithLoan, CollectionMismatch, CurrencyMismatch, SizeMismatch, BidCannotBorrow, BidRequiresLoan, InvalidCriteria } from "./Errors.sol";

import { IKettle } from "./interfaces/IKettle.sol";
import { FixedInterest } from "./models/FixedInterest.sol";
import { SafeTransfer } from "./SafeTransfer.sol";
import { Distributions } from "./Distributions.sol";
import { OfferController } from "./OfferController.sol";

contract Kettle is IKettle, OfferController, ERC721 {

    uint256 private _nextLienId = 1;
    mapping(uint256 => bytes32) public liens;

    constructor() OfferController() ERC721("Kettle", "KETTLE") public {}

    function tokenURI(uint256 id) public view override(ERC721) returns (string memory) {
        return string(abi.encodePacked("https://kettle.finance/liens/"));
    }

    function payments(Lien memory lien) public view returns (
        uint256 balance,
        uint256 principal,
        uint256 pastInterest,
        uint256 pastFee,
        uint256 currentInterest,
        uint256 currentFee
    ) {
        principal = lien.state.principal;
        (
            pastInterest, 
            pastFee, 
            currentInterest,
            currentFee
        ) = FixedInterest.computeInterestAndFees(
            lien.startTime,
            lien.state.paidThrough,
            lien.tenor,
            lien.period,
            lien.rate,
            lien.fee,
            principal
        );
        balance = principal + pastInterest + pastFee + currentInterest + currentFee;
    }

    function nextPaymentDate(Lien memory lien) public view returns (uint256 date) {
        return FixedInterest.computeNextPaymentDate(
            lien.startTime,
            lien.state.paidThrough,
            lien.tenor,
            lien.period,
            lien.gracePeriod
        );
    }

    function lienStatus(Lien memory lien) public view returns (uint8) {
        return FixedInterest.computeLienStatus(
            lien.startTime,
            lien.state.paidThrough,
            lien.tenor,
            lien.period,
            lien.gracePeriod,
            uint8(LienStatus.DEFAULTED),
            uint8(LienStatus.DELINQUENT),
            uint8(LienStatus.CURRENT)
        );
    }

    /*//////////////////////////////////////////////////
                    BORROW FLOWS
    //////////////////////////////////////////////////*/

    function borrow(
        LoanOffer calldata offer,
        uint256 amount,
        uint256 tokenId,
        address borrower,
        bytes calldata signature,
        bytes32[] calldata proof
    ) public returns (uint256 lienId){
        if (borrower == address(0)) borrower = msg.sender;

        _verifyCollateral(offer.collateral.criteria, offer.collateral.identifier, tokenId, proof);

        lienId = _borrow(offer, amount, tokenId, borrower, signature);

        SafeTransfer.transferToken(offer.collateral.collection, msg.sender, address(this), tokenId, offer.collateral.size);
        SafeTransfer.transferCurrency(offer.terms.currency, offer.lender, borrower, amount);
    }

    function _borrow(
        LoanOffer calldata offer,
        uint256 amount,
        uint256 tokenId,
        address borrower,
        bytes calldata signature
    ) internal returns (uint256 lienId) {

        Lien memory lien = Lien(
            offer.recipient,
            borrower,
            offer.terms.currency,
            offer.collateral.collection,
            tokenId,
            offer.collateral.size,
            amount,
            offer.terms.rate,
            offer.terms.fee,
            offer.terms.period,
            offer.terms.gracePeriod,
            offer.terms.tenor,
            block.timestamp,
            LienState({
                paidThrough: block.timestamp,
                principal: amount
            })
        );

        unchecked {
            liens[lienId = _nextLienId++] = keccak256(abi.encode(lien));
        }

        _takeLoanOffer(lienId, offer, lien, signature);

        // mint receipt to lender
        _safeMint(offer.lender, lienId);

        emit Borrow(
            lienId,
            offer.lender,
            lien.borrower,
            lien.recipient,
            lien.collection,
            lien.currency,
            lien.tokenId,
            lien.size,
            lien.principal,
            lien.rate,
            lien.fee,
            lien.period,
            lien.gracePeriod,
            lien.tenor,
            lien.startTime
        );
    }

    function loan(
        BorrowOffer calldata offer,
        bytes32[] calldata proof
    ) public returns (uint256 lienId) {
        lienId = _loan(offer);

        SafeTransfer.transferToken(offer.collateral.collection, offer.borrower, address(this), offer.collateral.identifier, offer.collateral.size);
        SafeTransfer.transferCurrency(offer.terms.currency, msg.sender, offer.borrower, offer.terms.amount);
    }

    function _loan(
        BorrowOffer calldata offer
    ) internal returns (uint256 lienId) {

        Lien memory lien = Lien(
            offer.recipient,
            offer.borrower,
            offer.terms.currency,
            offer.collateral.collection,
            offer.collateral.identifier,
            offer.collateral.size,
            offer.terms.amount,
            offer.terms.rate,
            offer.terms.fee,
            offer.terms.period,
            offer.terms.gracePeriod,
            offer.terms.tenor,
            block.timestamp,
            LienState({
                paidThrough: block.timestamp,
                principal: offer.terms.amount
            })
        );

        unchecked {
            liens[lienId = _nextLienId++] = keccak256(abi.encode(lien));
        }

        // _takeBorrowOffer(offer, lienId);

        // mint receipt to lender
        _safeMint(msg.sender, lienId);

        emit Borrow(
            lienId,
            msg.sender,
            lien.borrower,
            lien.recipient,
            lien.collection,
            lien.currency,
            lien.tokenId,
            lien.size,
            lien.principal,
            lien.rate,
            lien.fee,
            lien.period,
            lien.gracePeriod,
            lien.tenor,
            lien.startTime
        );
    }

    /*//////////////////////////////////////////////////
                    PAYMENT FLOWS
    //////////////////////////////////////////////////*/

    function principalPayment(
        uint256 lienId,
        uint256 _principal,
        Lien calldata lien
    ) public validateLien(lien, lienId) lienIsCurrent(lien) {
       (
            uint256 principal,
            uint256 pastInterest, 
            uint256 pastFee, 
            uint256 currentInterest, 
            uint256 currentFee
        ) = _payment(lien, lienId, _principal, false);

        SafeTransfer.transferCurrency(lien.currency, msg.sender, ownerOf(lienId), pastInterest + currentInterest + principal);
        SafeTransfer.transferCurrency(lien.currency, msg.sender, lien.recipient, pastFee + currentFee);
    }

    function interestPayment(
        uint256 lienId,
        Lien calldata lien
    ) public validateLien(lien, lienId) lienIsCurrent(lien) {
        (
            ,
            uint256 pastInterest, 
            uint256 pastFee, 
            uint256 currentInterest,
            uint256 currentFee
        ) = _payment(lien, lienId, 0, false);

        SafeTransfer.transferCurrency(lien.currency, msg.sender, ownerOf(lienId), pastInterest + currentInterest);
        SafeTransfer.transferCurrency(lien.currency, msg.sender, lien.recipient, pastFee + currentFee);
    }

    function curePayment(
        uint256 lienId,
        Lien calldata lien
    ) public validateLien(lien, lienId) lienIsCurrent(lien) {
        (
            ,
            uint256 pastInterest, 
            uint256 pastFee,
            ,
        ) = _payment(lien, lienId, 0, true);

        SafeTransfer.transferCurrency(lien.currency, msg.sender, ownerOf(lienId), pastInterest);
        SafeTransfer.transferCurrency(lien.currency, msg.sender, lien.recipient, pastFee);
    }

    function _payment(
        Lien calldata lien,
        uint256 lienId,
        uint256 _principal,
        bool cureOnly
    ) internal returns (
        uint256 principal,
        uint256 pastInterest, 
        uint256 pastFee, 
        uint256 currentInterest,
        uint256 currentFee
    ) {
        (
            ,
            ,
            pastInterest, 
            pastFee, 
            currentInterest, 
            currentFee
        ) = payments(lien);

        // calculate minimum amount to be paid
        uint256 minimumPayment = pastInterest + pastFee;
        if (!cureOnly) {
            minimumPayment += currentInterest + currentFee;
        }

        uint256 principal = Math.min(_principal, lien.state.principal);
        uint256 updatedPrincipal = lien.state.principal - principal;

        // update lien state
        Lien memory newLien = Lien(
            lien.recipient,
            lien.borrower,
            lien.currency,
            lien.collection,
            lien.tokenId,
            lien.size,
            lien.principal,
            lien.rate,
            lien.fee,
            lien.period,
            lien.gracePeriod,
            lien.tenor,
            lien.startTime,
            LienState({
                paidThrough: FixedInterest.computePaidThrough(
                    lien.state.paidThrough, 
                    lien.period,
                    cureOnly
                ),
                principal: updatedPrincipal
            })
        );

        liens[lienId] = keccak256(abi.encode(newLien));

        emit Payment(
            lienId, 
            principal,
            pastInterest,
            pastFee,
            cureOnly ? 0 : currentInterest,
            cureOnly ? 0 : currentFee,
            newLien.state.principal,
            newLien.state.paidThrough
        );
    }

    /*//////////////////////////////////////////////////
                    REFINANCE FLOWS
    //////////////////////////////////////////////////*/

    function refinance(
        uint256 oldLienId,
        uint256 amount,
        Lien calldata lien,
        LoanOffer calldata offer,
        bytes calldata signature,
        bytes32[] calldata proof
    ) public 
      validateLien(lien, oldLienId) 
      lienIsCurrent(lien) 
      onlyBorrower(lien )
      returns (uint256 newLienId) 
    {
        _verifyCollateral(offer.collateral.criteria, offer.collateral.identifier, lien.tokenId, proof);
        _matchLoanOfferWithLien(offer, lien);
        
        newLienId = _borrow(offer, amount, lien.tokenId, msg.sender, signature);

        (
            uint256 balance,
            uint256 principal,
            uint256 pastInterest, 
            uint256 pastFee, 
            uint256 currentInterest, 
            uint256 currentFee
        ) = payments(lien);
        
        Distributions.distributeLoanPayments(
            lien.currency,
            amount,                 // distribute new principal
            balance,
            principal,
            pastInterest,
            pastFee,
            currentInterest,
            currentFee,
            ownerOf(oldLienId),     // original lender
            lien.recipient,         // original recipient
            offer.lender,           // primary payer
            msg.sender,             // pays any remaining amount
            msg.sender              // receives net principal
        );

        // burn lender receipt
        _burn(oldLienId);
        delete liens[oldLienId];

        emit Refinance(
            oldLienId,
            newLienId,
            amount,
            balance,
            principal,
            pastInterest,
            pastFee,
            currentInterest,
            currentFee
        );
    }

    /*//////////////////////////////////////////////////
                    REPAY FLOWS
    //////////////////////////////////////////////////*/

    function repay(
        uint256 lienId,
        Lien calldata lien
    ) public validateLien(lien, lienId) lienIsCurrent(lien) {
        (
            uint256 principal,
            uint256 pastInterest,
            uint256 pastFee,
            uint256 currentInterest,
            uint256 currentFee
        ) = _repay(lien, lienId);

        SafeTransfer.transferToken(lien.collection, address(this), lien.borrower, lien.tokenId, lien.size);
        SafeTransfer.transferCurrency(lien.currency, msg.sender, ownerOf(lienId), principal + pastInterest + currentInterest);
        SafeTransfer.transferCurrency(lien.currency, msg.sender, lien.recipient, pastFee + currentFee);

        // burn lender receipt
        _burn(lienId);
        delete liens[lienId];
    }

    function _repay(
        Lien calldata lien,
        uint256 lienId
    ) internal returns (
        uint256 principal,
        uint256 pastInterest,
        uint256 pastFee,
        uint256 currentInterest,
        uint256 currentFee
    ) {
        uint256 balance;
        (
            balance,
            principal,
            pastInterest, 
            pastFee, 
            currentInterest, 
            currentFee
        ) = payments(lien);

        emit Repay(
            lienId, 
            balance,
            principal,
            pastInterest,
            pastFee,
            currentInterest,
            currentFee
        );
    }

    /*//////////////////////////////////////////////////
                    DEFAULT FLOWS
    //////////////////////////////////////////////////*/

    function claim(
        uint256 lienId,
        Lien calldata lien
    ) public validateLien(lien, lienId) {
        if (!_lienIsDefaulted(lien)) {
            revert LienIsCurrent();
        }

        address lender = ownerOf(lienId);

        // burn lender receipt
        _burn(lienId);
        delete liens[lienId];

        SafeTransfer.transferToken(lien.collection, address(this), lender, lien.tokenId, lien.size);

        emit Claim(lienId, lender);
    }

    /*//////////////////////////////////////////////////
                    MARKETPLACE FLOWS
    //////////////////////////////////////////////////*/

    /**
     * @dev Execute market order
     */
     function marketOrder(
        uint256 tokenId,
        MarketOffer calldata offer,
        bytes calldata signature,
        bytes32[] calldata proof
     ) public {

        _verifyCollateral(offer.collateral.criteria, offer.collateral.identifier, tokenId, proof);
        _takeMarketOffer(offer, signature);

        if (offer.side == Side.BID) {
            if (offer.terms.withLoan) {
                revert BidRequiresLoan();
            }
            SafeTransfer.transferToken(offer.collateral.collection, msg.sender, offer.maker, tokenId, offer.collateral.size);
            SafeTransfer.transferCurrency(offer.terms.currency, offer.maker, msg.sender, offer.terms.amount);
            
            emit MarketOrder(
                offer.maker,
                msg.sender,
                offer.terms.currency,
                offer.collateral.collection,
                tokenId,
                offer.collateral.size,
                offer.terms.amount
            );

        } else {
            SafeTransfer.transferToken(offer.collateral.collection, offer.maker, msg.sender, tokenId, offer.collateral.size);
            SafeTransfer.transferCurrency(offer.terms.currency, msg.sender, offer.maker, offer.terms.amount);
            
            emit MarketOrder(
                msg.sender,
                offer.maker,
                offer.terms.currency,
                offer.collateral.collection,
                tokenId,
                offer.collateral.size,
                offer.terms.amount
            );
        }
    }

    /**
     * @dev Purchase an asset with a loan offer
     * @param loanOffer loan offer
     * @param askOffer ask offer
     */
    function buyWithLoan(
        uint256 tokenId,
        uint256 amount,
        LoanOffer calldata loanOffer,
        MarketOffer calldata askOffer,
        bytes calldata loanOfferSignature,
        bytes calldata askOfferSignature,
        bytes32[] calldata loanProof,
        bytes32[] calldata askProof
    ) public returns (uint256 lienId) {

        if (askOffer.side != Side.ASK) {
            revert OfferNotAsk();
        }

        _verifyCollateral(loanOffer.collateral.criteria, loanOffer.collateral.identifier, tokenId, loanProof);
        _verifyCollateral(askOffer.collateral.criteria, askOffer.collateral.identifier, tokenId, askProof);

        _matchMarketOfferWithLoanOffer(askOffer, loanOffer);

        // take market offer
        _takeMarketOffer(askOffer, askOfferSignature);

        // start a lien
        uint256 _borrowAmount = Math.min(amount, askOffer.terms.amount);
        lienId = _borrow(loanOffer, _borrowAmount, tokenId, msg.sender, loanOfferSignature);

        // transfer principal to seller
        SafeTransfer.transferCurrency(loanOffer.terms.currency, loanOffer.lender, askOffer.maker, _borrowAmount);

        // transfer rest from buyer to seller
        SafeTransfer.transferCurrency(loanOffer.terms.currency, msg.sender, askOffer.maker, askOffer.terms.amount - _borrowAmount);

        // lock collateral
        SafeTransfer.transferToken(loanOffer.collateral.collection, askOffer.maker, address(this), tokenId, loanOffer.collateral.size);

        emit BuyWithLoan(
            lienId,
            msg.sender,
            askOffer.maker,
            askOffer.terms.currency,
            askOffer.collateral.collection,
            tokenId,
            askOffer.collateral.size,
            askOffer.terms.amount,
            _borrowAmount
        );
    }

    /**
     * @dev Sell an asset into a bid with a loan
     * @param loanOffer loan offer
     * @param bidOffer ask offer
     */
    function sellWithLoan(
        uint256 tokenId,
        LoanOffer calldata loanOffer,
        MarketOffer calldata bidOffer,
        bytes calldata loanOfferSignature,
        bytes calldata bidOfferSignature,
        bytes32[] calldata loanProof,
        bytes32[] calldata bidProof
    ) public returns (uint256 lienId) {

        if (bidOffer.side != Side.BID) {
            revert OfferNotBid();
        }

        if (!bidOffer.terms.withLoan) {
            revert BidNotWithLoan();
        }

        bytes32 _loanOfferHash = _hashLoanOffer(loanOffer);
        if (!(bidOffer.terms.loanOfferHash == _loanOfferHash)) {
            revert BidCannotBorrow();
        }

        _verifyCollateral(loanOffer.collateral.criteria, loanOffer.collateral.identifier, tokenId, loanProof);
        _verifyCollateral(bidOffer.collateral.criteria, bidOffer.collateral.identifier, tokenId, bidProof);

        _matchMarketOfferWithLoanOffer(bidOffer, loanOffer);

        // take market offer
        _takeMarketOffer(bidOffer, bidOfferSignature);

        // start loan
        lienId = _borrow(loanOffer, bidOffer.terms.borrowAmount, tokenId, bidOffer.maker, loanOfferSignature);

        // transfer borrow amount to this
        SafeTransfer.transferCurrency(loanOffer.terms.currency, loanOffer.lender, address(this), bidOffer.terms.borrowAmount);

        // transfer rest of bid from buyer to this
        SafeTransfer.transferCurrency(bidOffer.terms.currency, bidOffer.maker, address(this), bidOffer.terms.amount - bidOffer.terms.borrowAmount);

        // transfer all currency to seller
        SafeTransfer.transferCurrency(bidOffer.terms.currency, address(this), msg.sender, bidOffer.terms.amount);

        // lock collateral
        SafeTransfer.transferToken(loanOffer.collateral.collection, msg.sender, address(this), tokenId, bidOffer.collateral.size);

        emit SellWithLoan(
            lienId,
            bidOffer.maker,
            msg.sender,
            bidOffer.terms.currency,
            bidOffer.collateral.collection,
            tokenId,
            bidOffer.collateral.size,
            bidOffer.terms.amount,
            bidOffer.terms.borrowAmount
        );
    }

    /**
     * @dev Purchase an asset in a lien, closes lien, and transfers asset to buyer
     * @param lienId lien identifier
     * @param lien the active lien
     * @param askOffer ask offer
     */
    function buyInLien(
        uint256 lienId,
        Lien calldata lien,
        MarketOffer calldata askOffer,
        bytes calldata askOfferSignature,
        bytes32[] calldata proof
    ) public validateLien(lien, lienId) lienIsCurrent(lien) {
        if (lien.borrower != askOffer.maker) {
            revert MakerIsNotBorrower();
        }

        if (askOffer.side != Side.ASK) {
            revert OfferNotAsk();
        }

        _verifyCollateral(askOffer.collateral.criteria, askOffer.collateral.identifier, lien.tokenId, proof);
        _matchMarketOfferWithLien(askOffer, lien);

        // take market offer
        _takeMarketOffer(askOffer, askOfferSignature);

        (
            uint256 balance,
            uint256 principal,
            uint256 pastInterest, 
            uint256 pastFee, 
            uint256 currentInterest, 
            uint256 currentFee
        ) = payments(lien);

        // ask amount must be greater than amount owed
        if (askOffer.terms.amount < balance) {
            revert InsufficientAskAmount();
        }

        Distributions.distributeLoanPayments(
            lien.currency, 
            askOffer.terms.amount,      // distribute ask amount
            balance, 
            principal,
            pastInterest, 
            pastFee, 
            currentInterest, 
            currentFee, 
            ownerOf(lienId), 
            lien.recipient, 
            msg.sender,                 // buyer pays primary amount
            msg.sender,                 // buyer pays residual amount
            askOffer.maker              // seller receives net principal
        );

        // transfer collateral from this to buyer
        SafeTransfer.transferToken(
            lien.collection, 
            address(this),
            msg.sender, 
            lien.tokenId, 
            lien.size
        );

        // burn lender receipt
        _burn(lienId);
        delete liens[lienId];

        emit BuyInLien(
            lienId,
            msg.sender,
            lien.borrower,
            askOffer.terms.currency,
            askOffer.collateral.collection,
            lien.tokenId,
            lien.size,
            askOffer.terms.amount,
            balance,
            principal,
            pastInterest,
            pastFee,
            currentInterest,
            currentFee
        );
    }

    /**
     * @dev Sell an asset in a lien with a bid
     * @param lienId lien identifier
     * @param lien the active lien
     * @param bidOffer bid offer
     */
    function sellInLien(
        uint256 lienId,
        Lien calldata lien,
        MarketOffer calldata bidOffer,
        bytes calldata bidOfferSignature,
        bytes32[] calldata proof
    ) public validateLien(lien, lienId) lienIsCurrent(lien) onlyBorrower(lien) {
        if (bidOffer.side != Side.BID) {
            revert OfferNotBid();
        }

        if (bidOffer.terms.withLoan) {
            revert BidRequiresLoan();
        }

        _verifyCollateral(bidOffer.collateral.criteria, bidOffer.collateral.identifier, lien.tokenId, proof);
        _matchMarketOfferWithLien(bidOffer, lien);

        // take market offer
        _takeMarketOffer(bidOffer, bidOfferSignature);

        (
            uint256 balance,
            uint256 principal,
            uint256 pastInterest, 
            uint256 pastFee, 
            uint256 currentInterest, 
            uint256 currentFee
        ) = payments(lien);
        
        Distributions.distributeLoanPayments(
            lien.currency,
            bidOffer.terms.amount,          // distribute bid amount
            balance,
            principal,
            pastInterest,
            pastFee,
            currentInterest,
            currentFee,
            ownerOf(lienId),
            lien.recipient,
            bidOffer.maker,                 // buyer pays primary amount
            msg.sender,                     // seller pays residual amount
            msg.sender                      // seller receives net principal
        );
        
        // transfer collateral from this to buyer
        SafeTransfer.transferToken(lien.collection, address(this), bidOffer.maker, lien.tokenId, lien.size);

        // burn lender receipt
        _burn(lienId);
        delete liens[lienId];

        emit SellInLien(
            lienId, 
            bidOffer.maker, 
            lien.borrower, 
            lien.currency, 
            lien.collection, 
            lien.tokenId, 
            lien.size, 
            bidOffer.terms.amount, 
            balance, 
            principal, 
            pastInterest, 
            pastFee, 
            currentInterest, 
            currentFee
        );
    }

    function buyInLienWithLoan(
        uint256 lienId,
        uint256 amount,
        Lien calldata lien,
        LoanOffer calldata loanOffer,
        MarketOffer calldata askOffer,
        bytes calldata loanOfferSignature,
        bytes calldata askOfferSignature,
        bytes32[] calldata loanProof,
        bytes32[] calldata askProof
    ) public validateLien(lien, lienId) lienIsCurrent(lien) returns (uint256 newLienId) {
        if (askOffer.maker != lien.borrower) {
            revert MakerIsNotBorrower();
        }

        if (askOffer.side != Side.ASK) {
            revert OfferNotAsk();
        }

        _verifyCollateral(loanOffer.collateral.criteria, loanOffer.collateral.identifier, lien.tokenId, loanProof);
        _verifyCollateral(askOffer.collateral.criteria, askOffer.collateral.identifier, lien.tokenId, askProof);

        _matchMarketOfferWithLien(askOffer, lien);
        _matchLoanOfferWithLien(loanOffer, lien);

        // take market offer
        _takeMarketOffer(askOffer, askOfferSignature);

        (
            uint256 balance,
            uint256 principal,
            uint256 pastInterest, 
            uint256 pastFee, 
            uint256 currentInterest, 
            uint256 currentFee
        ) = payments(lien);

        if (askOffer.terms.amount < balance) {
            revert InsufficientAskAmount();
        }

        // start new loan
        uint256 _borrowAmount = Math.min(amount, askOffer.terms.amount);
        newLienId = _borrow(loanOffer, _borrowAmount, lien.tokenId, msg.sender, loanOfferSignature);

        Distributions.distributeLoanPayments(
            lien.currency,
            _borrowAmount,                  // distribute new principal
            balance,
            principal,
            pastInterest,
            pastFee,
            currentInterest,
            currentFee,
            ownerOf(lienId),
            lien.recipient,
            loanOffer.lender,               // new lender pays primary amount
            msg.sender,                     // buyer pays any remaining amount
            lien.borrower                   // borrower receives net principal
        );

        // remaining amount owed by buyer is the diff between ask and max of borrow or amount owed
        // buyer already pays off lender if borrow amount is less than amount owed
        // if borrow amount is greater than amount owed, then buyer pays rest
        uint256 remainingAmountOwed = askOffer.terms.amount - Math.max(_borrowAmount, balance);
        SafeTransfer.transferCurrency(lien.currency, msg.sender, askOffer.maker, remainingAmountOwed);

        // burn lender receipt
        _burn(lienId);
        delete liens[lienId];

        emit BuyInLienWithLoan(
            lienId,
            newLienId,
            msg.sender,
            lien.borrower,
            askOffer.terms.currency,
            askOffer.collateral.collection,
            lien.tokenId,
            lien.size,
            askOffer.terms.amount,
            _borrowAmount,
            balance,
            principal,
            pastInterest,
            pastFee,
            currentInterest,
            currentFee
        );
    }

    function sellInLienWithLoan(
        uint256 lienId,
        Lien calldata lien,
        LoanOffer calldata loanOffer,
        MarketOffer calldata bidOffer,
        bytes calldata loanOfferSignature,
        bytes calldata bidOfferSignature,
        bytes32[] calldata loanProof,
        bytes32[] calldata bidProof
    ) public validateLien(lien, lienId) lienIsCurrent(lien) onlyBorrower(lien) returns (uint256 newLienId) {
        if (bidOffer.side != Side.BID) {
            revert OfferNotBid();
        }

        if (!bidOffer.terms.withLoan) {
            revert BidNotWithLoan();
        }

        _verifyCollateral(loanOffer.collateral.criteria, loanOffer.collateral.identifier, lien.tokenId, loanProof);
        _verifyCollateral(bidOffer.collateral.criteria, bidOffer.collateral.identifier, lien.tokenId, bidProof);

        _matchMarketOfferWithLien(bidOffer, lien);
        _matchLoanOfferWithLien(loanOffer, lien);

        // take market offer
        _takeMarketOffer(bidOffer, bidOfferSignature);

        // borrow from loan offer
        newLienId = _borrow(loanOffer, bidOffer.terms.borrowAmount, lien.tokenId, msg.sender, loanOfferSignature);

        // transfer borrow amount to this
        SafeTransfer.transferCurrency(lien.currency, loanOffer.lender, address(this), bidOffer.terms.borrowAmount);

        // transfer rest of bid from buyer to this
        SafeTransfer.transferCurrency(lien.currency, bidOffer.maker, address(this), bidOffer.terms.amount - bidOffer.terms.borrowAmount);

        (
            uint256 balance,
            uint256 principal,
            uint256 pastInterest, 
            uint256 pastFee, 
            uint256 currentInterest, 
            uint256 currentFee
        ) = payments(lien);

        Distributions.distributeLoanPayments(
            lien.currency,
            bidOffer.terms.amount,      // distribute bid amount
            balance,
            principal,
            pastInterest,
            pastFee,
            currentInterest,
            currentFee,
            ownerOf(lienId),
            lien.recipient,
            address(this),              // this is the primary payer
            msg.sender,                 // seller pays residual amount
            msg.sender                  // seller receives net principal
        );

        // burn lender receipt
        _burn(lienId);
        delete liens[lienId];

        emit SellInLienWithLoan(
            lienId, 
            newLienId, 
            bidOffer.maker, 
            lien.borrower, 
            lien.currency, 
            lien.collection, 
            lien.tokenId, 
            lien.size, 
            bidOffer.terms.amount,
            bidOffer.terms.borrowAmount, 
            balance,
            principal, 
            pastInterest, 
            pastFee, 
            currentInterest, 
            currentFee
        );
    }

    /*//////////////////////////////////////////////////
                    MATCHING POLICIES
    //////////////////////////////////////////////////*/

    function _verifyCollateral(
        Criteria criteria,
        uint256 identifier,
        uint256 tokenId,
        bytes32[] calldata proof
    ) internal view {
        if (criteria == Criteria.PROOF) {
            if (proof.length == 0 || !MerkleProof.verifyCalldata(proof, bytes32(identifier), keccak256(abi.encode(bytes32(tokenId))))) {
                revert InvalidCriteria();
            }
        } else {
            if (!(tokenId == identifier)) {
                revert InvalidCriteria();
            }
        }
    }

    function _matchMarketOfferWithLoanOffer(
        MarketOffer calldata marketOffer,
        LoanOffer calldata loanOffer
    ) internal pure returns (bool) {
        if (marketOffer.collateral.collection != loanOffer.collateral.collection) {
            revert CollectionMismatch();
        }

        if (marketOffer.terms.currency != loanOffer.terms.currency) {
            revert CurrencyMismatch();
        }

        if (marketOffer.collateral.size != loanOffer.collateral.size) {
            revert SizeMismatch();
        }
    }

    function _matchMarketOfferWithLien(
        MarketOffer calldata marketOffer,
        Lien calldata lien
    ) internal pure returns (bool) {
        if (marketOffer.collateral.collection != lien.collection) {
            revert CollectionMismatch();
        }

        if (marketOffer.terms.currency != lien.currency) {
            revert CurrencyMismatch();
        }

        if (marketOffer.collateral.size != lien.size) {
            revert SizeMismatch();
        }
    }

    function _matchLoanOfferWithLien(
        LoanOffer calldata loanOffer,
        Lien calldata lien
    ) internal pure returns (bool) {
        if (loanOffer.collateral.collection != lien.collection) {
            revert CollectionMismatch();
        }

        if (loanOffer.terms.currency != lien.currency) {
            revert CurrencyMismatch();
        }

        if (loanOffer.collateral.size != lien.size) {
            revert SizeMismatch();
        }
    }

    /*//////////////////////////////////////////////////
                        MODIFIERS
    //////////////////////////////////////////////////*/

    modifier validateLien(Lien calldata lien, uint256 lienId) {
        if (!_validateLien(lien, lienId)) {
            revert InvalidLien();
        }

        _;
    }

    modifier lienIsCurrent(Lien calldata lien) {
        if (_lienIsDefaulted(lien)) {
            revert LienDefaulted();
        }

        _;
    }

    modifier onlyBorrower(Lien calldata lien) {
        if (msg.sender != lien.borrower) {
            revert OnlyBorrower();
        }

        _;
    }

    function _validateLien(
        Lien calldata lien,
        uint256 lienId
    ) internal view returns (bool) {
        return liens[lienId] == keccak256(abi.encode(lien));
    }

    function _lienIsDefaulted(
        Lien calldata lien
    ) internal view returns (bool) {
        return (lien.state.paidThrough + lien.period + lien.gracePeriod) < block.timestamp;
    }
}
